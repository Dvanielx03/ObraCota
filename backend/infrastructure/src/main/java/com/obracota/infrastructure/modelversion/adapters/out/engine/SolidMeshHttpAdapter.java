package com.obracota.infrastructure.modelversion.adapters.out.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.*;
import com.obracota.domain.modelversion.port.SolidMeshPort;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * {@link SolidMeshPort} over the engine's {@code GET /dwg/solids?project&version&sha256}. A 200 must carry the
 * mesh's identity ({@code X-ObraCota-Source-Sha256} equal to the version's SHA-256, {@code X-ObraCota-Tessellator})
 * and a {@code Content-Length} up to {@code dwg.solids.max-bytes}; anything else is a contract error (502), as in
 * {@code IfcEngineHttpAdapter}. Only a failed connection, a timeout or a 503 are «unavailable».
 * <p>
 * The first mesh of a large DWG takes the engine about 21 s (Rug Dots, 1,257 solids; ACIS-LECTOR §5). The engine
 * bounds each request to {@code ENGINE_BUSY_WAIT_S + ENGINE_SOLIDS_DEADLINE_S} (170 s by default, waits included),
 * so the timeout (180 s) is that budget plus a margin; later requests are the engine's cached file.
 * <p>
 * The client's {@code If-None-Match} is passed on; a 304 must carry the same identity headers and becomes
 * {@link Mesh#unchanged}, so a revalidation never makes the engine mesh the DWG again.
 */
@Component
class SolidMeshHttpAdapter implements SolidMeshPort {
    static final String UNAVAILABLE = "El motor de modelos no está disponible en este momento.";
    static final String TIMEOUT = "El motor tardó demasiado en teselar el DWG; vuelve a intentarlo.";
    private static final int ERROR_BODY_LIMIT = 64 * 1024;

    private final URI engine;
    private final Duration timeout;
    private final long maxBytes;
    private final String token;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    SolidMeshHttpAdapter(String engine, Duration timeout, long maxBytes) { this(engine, timeout, maxBytes, ""); }

    @Autowired
    SolidMeshHttpAdapter(@Value("${IFC_ENGINE_URL:http://localhost:8000}") String engine,
                         @Value("${dwg.solids.timeout:PT180S}") Duration timeout,
                         @Value("${dwg.solids.max-bytes:268435456}") long maxBytes,
                         @Value("${ENGINE_TOKEN:}") String token) {
        this.engine = URI.create(engine);
        this.timeout = timeout;
        this.maxBytes = maxBytes;
        this.token = token == null ? "" : token.strip();
    }

    @Override
    public Mesh solids(UUID project, UUID version, String sha256, String ifNoneMatch) {
        var uri = UriComponentsBuilder.fromUri(engine).path("/dwg/solids").queryParam("project", project)
            .queryParam("version", version).queryParam("sha256", sha256).build().encode().toUri();
        var builder = HttpRequest.newBuilder(uri).timeout(timeout).header("Accept", "application/gzip, application/json").GET();
        if (!token.isEmpty()) builder.header("Authorization", "Bearer " + token);
        if (forwardable(ifNoneMatch)) builder.header("If-None-Match", ifNoneMatch.strip());
        HttpResponse<InputStream> response;
        try {
            response = client.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (HttpTimeoutException e) {
            throw new EngineUnavailableException(null, TIMEOUT, e);
        } catch (IOException e) {
            throw new EngineUnavailableException(null, UNAVAILABLE, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EngineUnavailableException(null, UNAVAILABLE, e);
        }
        var content = response.body();
        try {
            int status = response.statusCode();
            if (status != 200 && status != 304) throw failure(status, limited(content));
            var headers = response.headers();
            var source = headers.firstValue("X-ObraCota-Source-Sha256").orElse("").toLowerCase(Locale.ROOT);
            var tessellator = headers.firstValue("X-ObraCota-Tessellator").orElse("");
            if (!source.equals(sha256.toLowerCase(Locale.ROOT)))
                throw new EngineContractException("/dwg/solids answered the mesh of another file");
            var format = headers.firstValue("X-ObraCota-Format").orElse("obracota.dwg-solids/1");
            if (status == 304) {
                if (ifNoneMatch == null) throw new EngineContractException("/dwg/solids answered 304 to a request without If-None-Match");
                limited(content);  // drains and closes the empty body
                try {
                    return Mesh.unchanged(source, tessellator, format);
                } catch (IllegalArgumentException e) {
                    throw new EngineContractException("/dwg/solids answered outside the contract: " + e.getMessage(), e);
                }
            }
            var length = headers.firstValueAsLong("Content-Length");
            if (length.isEmpty() || length.getAsLong() < 0 || length.getAsLong() > maxBytes)
                throw new EngineContractException("/dwg/solids answered without a usable Content-Length");
            try {
                return new Mesh(content, length.getAsLong(), source, tessellator, format,
                    headers.firstValue("Content-Type").orElse("application/gzip"));
            } catch (IllegalArgumentException e) {
                throw new EngineContractException("/dwg/solids answered outside the contract: " + e.getMessage(), e);
            }
        } catch (RuntimeException e) {
            try { content.close(); } catch (IOException ignored) { }
            throw e;
        }
    }

    /** A client's {@code If-None-Match} is passed on only if it is short, printable ASCII (no header injection). */
    static boolean forwardable(String ifNoneMatch) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank() || ifNoneMatch.length() > 1024) return false;
        return ifNoneMatch.chars().allMatch(c -> c >= 0x20 && c < 0x7f);
    }

    /** The engine's error {@code {"detail", "code"}} as the exception the use cases expect. */
    private RuntimeException failure(int status, byte[] body) {
        String detail = null, code = null;
        try {
            JsonNode tree = json.readTree(body);
            if (tree != null && tree.path("detail").isTextual() && !tree.path("detail").asText().isBlank()) detail = tree.get("detail").asText();
            if (tree != null && tree.path("code").isTextual() && !tree.path("code").asText().isBlank()) code = tree.get("code").asText();
        } catch (IOException notJson) {
            if (status == 503) return new EngineUnavailableException(null, UNAVAILABLE);
            return new EngineContractException("Engine answered " + status + " without a JSON body");
        }
        if (status == 503) return new EngineUnavailableException(code, Objects.requireNonNullElse(detail, UNAVAILABLE));
        if (detail == null) return new EngineContractException("Engine answered " + status + " without a detail");
        return switch (status) {
            case 400 -> new InvalidRequestApplicationException(Objects.requireNonNullElse(code, "PARAMS_INVALID"), detail);
            case 404 -> new NotFoundApplicationException(detail);
            case 409 -> new ConflictApplicationException(detail);
            case 422 -> new UnprocessableApplicationException(Objects.requireNonNullElse(code, "MODEL_UNREADABLE"), detail);
            default -> new EngineContractException("Engine answered " + status + " (" + code + "): " + detail);
        };
    }

    private static byte[] limited(InputStream content) {
        try (content) {
            return content.readNBytes(ERROR_BODY_LIMIT);
        } catch (IOException e) {
            return new byte[0];
        }
    }
}
