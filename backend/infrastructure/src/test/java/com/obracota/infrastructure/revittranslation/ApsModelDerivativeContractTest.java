package com.obracota.infrastructure.revittranslation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.revittranslation.port.RevitTranslationPort;
import com.obracota.domain.revittranslation.model.RevitTranslation.Status;
import com.obracota.infrastructure.revittranslation.adapters.out.aps.ApsModelDerivative;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** The APS calls against a local stand-in: no network, no credentials. */
class ApsModelDerivativeContractTest {
    static final String OBJECT_ID = "urn:adsk.objects:os.object:obracota-test/v1.rvt";
    static final String DERIVATIVE = "urn:adsk.viewing:fs.file:abc/output/Resource/model.ifc";
    static final byte[] IFC = "ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;\n".getBytes(StandardCharsets.UTF_8);
    final ObjectMapper json = new ObjectMapper();
    @TempDir Path dir;
    HttpServer server;
    String root;
    final List<String> calls = new CopyOnWriteArrayList<>();
    final AtomicReference<String> basic = new AtomicReference<>(), force = new AtomicReference<>(), cookie = new AtomicReference<>();
    final AtomicReference<String> job = new AtomicReference<>(), uploaded = new AtomicReference<>();
    final AtomicInteger polls = new AtomicInteger(), tokens = new AtomicInteger();
    volatile String finalStatus = "success";

    @BeforeEach void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        root = "http://127.0.0.1:" + server.getAddress().getPort() + "/";
        server.createContext("/", this::answer);
        server.start();
    }
    @AfterEach void stop() { server.stop(0); }

    void answer(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod(), path = exchange.getRequestURI().getRawPath();
        String query = Objects.requireNonNullElse(exchange.getRequestURI().getRawQuery(), "");
        calls.add(method + " " + path);
        String auth = exchange.getRequestHeaders().getFirst("Authorization");
        byte[] request = exchange.getRequestBody().readAllBytes();
        if (path.equals("/authentication/v2/token")) {
            basic.set(auth);
            tokens.incrementAndGet();
            assertTrue(new String(request, StandardCharsets.UTF_8).contains("grant_type=client_credentials"));
            send(exchange, 200, Map.of("access_token", "tok", "token_type", "Bearer", "expires_in", 3599));
            return;
        }
        if (path.startsWith("/s3/")) { uploaded.set(new String(request, StandardCharsets.UTF_8)); send(exchange, 200, Map.of()); return; }
        if (path.equals("/download/model.ifc")) {
            cookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
            exchange.sendResponseHeaders(200, IFC.length);
            try (var out = exchange.getResponseBody()) { out.write(IFC); }
            return;
        }
        assertEquals("Bearer tok", auth, "every APS call carries the token");
        if (path.equals("/oss/v2/buckets")) { send(exchange, 409, Map.of("reason", "Bucket already exists")); return; }
        if (path.endsWith("/signeds3upload") && method.equals("GET")) {
            assertTrue(query.contains("parts=1"));
            send(exchange, 200, Map.of("uploadKey", "key-1", "urls", List.of(root + "s3/part1")));
            return;
        }
        if (path.endsWith("/signeds3upload")) {
            assertEquals("key-1", json.readTree(request).path("uploadKey").asText());
            send(exchange, 200, Map.of("objectId", OBJECT_ID, "objectKey", "v1.rvt"));
            return;
        }
        if (path.equals("/modelderivative/v2/designdata/job")) {
            force.set(exchange.getRequestHeaders().getFirst("x-ads-force"));
            job.set(new String(request, StandardCharsets.UTF_8));
            send(exchange, 200, Map.of("result", "created"));
            return;
        }
        if (path.endsWith("/manifest") ) {
            if (polls.incrementAndGet() < 3) { send(exchange, 200, Map.of("status", "inprogress", "progress", polls.get() * 40 + "% complete")); return; }
            if (finalStatus.equals("failed")) {
                send(exchange, 200, Map.of("status", "failed", "progress", "complete", "derivatives", List.of(Map.of("outputType", "ifc", "status", "failed",
                    "messages", List.of(Map.of("type", "error", "code", "TranslationWorker-InternalFailure", "message", "Unrecoverable exit code from extractor"))))));
                return;
            }
            send(exchange, 200, Map.of("status", "success", "progress", "complete", "derivatives", List.of(
                Map.of("outputType", "svf2", "children", List.of()),
                Map.of("outputType", "ifc", "status", "success", "children", List.of(
                    Map.of("type", "resource", "role", "ifc", "mime", "application/octet-stream", "urn", DERIVATIVE))))));
            return;
        }
        if (path.endsWith("/signedcookies")) {
            assertTrue(path.contains("urn%3Aadsk.viewing%3Afs.file%3Aabc%2Foutput%2FResource%2Fmodel.ifc"), path);
            exchange.getResponseHeaders().add("Set-Cookie", "CloudFront-Policy=pol; Path=/; Secure; HttpOnly");
            exchange.getResponseHeaders().add("Set-Cookie", "CloudFront-Key-Pair-Id=kp; Path=/");
            exchange.getResponseHeaders().add("Set-Cookie", "CloudFront-Signature=sig; Path=/");
            send(exchange, 200, Map.of("url", root + "download/model.ifc", "size", IFC.length));
            return;
        }
        send(exchange, 404, Map.of());
    }

    void send(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = json.writeValueAsBytes(body);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) { out.write(bytes); }
    }

    ApsModelDerivative adapter(String id, String secret) {
        return new ApsModelDerivative(json, id, secret, "", URI.create(root), Duration.ZERO, Duration.ofSeconds(20));
    }

    @Test void uploadsTranslatesAndDownloadsTheIfc() throws Exception {
        Path rvt = Files.write(dir.resolve("in.rvt"), "OLE-bytes".getBytes(StandardCharsets.UTF_8)), ifc = dir.resolve("out.ifc");
        var stages = new ArrayList<String>();
        adapter("client", "secret").translate("v1.rvt", rvt, ifc, (status, text) -> stages.add(status + " " + text));
        assertArrayEquals(IFC, Files.readAllBytes(ifc));
        assertEquals("Basic " + Base64.getEncoder().encodeToString("client:secret".getBytes(StandardCharsets.UTF_8)), basic.get());
        assertEquals(1, tokens.get(), "the token is reused until it expires");
        assertEquals("OLE-bytes", uploaded.get());
        assertEquals("true", force.get());
        var body = json.readTree(job.get());
        String urn = Base64.getUrlEncoder().withoutPadding().encodeToString(OBJECT_ID.getBytes(StandardCharsets.UTF_8));
        assertEquals(urn, body.at("/input/urn").asText());
        assertFalse(urn.contains("=") || urn.contains("+") || urn.contains("/"));
        assertEquals("ifc", body.at("/output/formats/0/type").asText());
        assertEquals("CloudFront-Policy=pol; CloudFront-Key-Pair-Id=kp; CloudFront-Signature=sig", cookie.get());
        assertTrue(calls.contains("GET /modelderivative/v2/designdata/" + urn + "/manifest"));
        assertTrue(stages.stream().allMatch(s -> s.startsWith(Status.TRANSLATING.name())));
        assertTrue(stages.stream().anyMatch(s -> s.contains("80% complete")), stages.toString());
    }

    @Test void aFailedManifestTellsAutodeskReason() throws Exception {
        finalStatus = "failed";
        Path rvt = Files.write(dir.resolve("in.rvt"), new byte[]{1, 2, 3});
        var failure = assertThrows(RevitTranslationPort.Failure.class,
            () -> adapter("client", "secret").translate("v1.rvt", rvt, dir.resolve("out.ifc"), (s, t) -> {}));
        assertTrue(failure.getMessage().startsWith("Autodesk no pudo convertir el RVT."), failure.getMessage());
        assertTrue(failure.getMessage().contains("Unrecoverable exit code from extractor"));
        assertFalse(failure.getMessage().contains("secret") || failure.getMessage().contains("tok"));
    }

    @Test void withoutCredentialsItIsOffAndCallsNothing() {
        var off = adapter("", " ");
        assertFalse(off.available());
        assertThrows(RevitTranslationPort.Failure.class, () -> off.translate("v1.rvt", dir.resolve("x.rvt"), dir.resolve("x.ifc"), (s, t) -> {}));
        assertTrue(calls.isEmpty());
        assertTrue(adapter("client", "secret").available());
    }
}
