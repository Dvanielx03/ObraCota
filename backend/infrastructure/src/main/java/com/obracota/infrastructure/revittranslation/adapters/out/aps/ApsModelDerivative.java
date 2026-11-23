package com.obracota.infrastructure.revittranslation.adapters.out.aps;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.revittranslation.port.RevitTranslationPort;
import com.obracota.domain.revittranslation.model.RevitTranslation.Status;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * RVT to IFC with Autodesk Platform Services: two-legged token, a transient OSS bucket (objects expire in 24 h),
 * signed S3 upload, a Model Derivative job with output {@code ifc}, the manifest polled until it ends and the IFC
 * downloaded with its signed cookies. Neither the secret nor the token are logged or put in an error message.
 */
public class ApsModelDerivative implements RevitTranslationPort {
    static final String SCOPES = "data:read data:write data:create bucket:create bucket:read";
    /** Up to this size the RVT goes in one PUT; above it, in parts of {@link #PART} bytes (S3 takes 5 MB to 100 MB). */
    static final long SINGLE_PART = 100L * 1024 * 1024;
    static final long PART = 64L * 1024 * 1024;

    private final ObjectMapper json;
    private final String clientId, clientSecret, bucket;
    private final URI base;
    private final Duration poll, deadline;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20))
        .followRedirects(HttpClient.Redirect.NORMAL).build();
    private String token;
    private Instant tokenUntil = Instant.EPOCH;
    private volatile boolean bucketReady;

    public ApsModelDerivative(ObjectMapper json, String clientId, String clientSecret, String bucket, URI base,
                              Duration poll, Duration deadline) {
        this.json = json;
        this.clientId = clientId == null ? "" : clientId.strip();
        this.clientSecret = clientSecret == null ? "" : clientSecret.strip();
        this.bucket = bucketFor(this.clientId, bucket);
        this.base = base; this.poll = poll; this.deadline = deadline;
    }

    /**
     * The configured bucket key, or {@code obracota-} plus the first 12 hex digits of the SHA-256 of the client id
     * (keys are global across APS, so one per application). Lowercase, 3 to 128 characters of {@code [-_.a-z0-9]}.
     */
    static String bucketFor(String clientId, String configured) {
        if (configured != null && !configured.isBlank()) {
            String key = configured.strip().toLowerCase(Locale.ROOT);
            if (!key.matches("[-_.a-z0-9]{3,128}"))
                throw new IllegalArgumentException("APS_BUCKET debe tener de 3 a 128 caracteres [-_.a-z0-9].");
            return key;
        }
        try {
            var digest = MessageDigest.getInstance("SHA-256").digest(clientId.getBytes(StandardCharsets.UTF_8));
            return "obracota-" + HexFormat.of().formatHex(digest).substring(0, 12);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    String bucket() { return bucket; }

    @Override public boolean available() { return !clientId.isEmpty() && !clientSecret.isEmpty(); }

    @Override
    public void translate(String objectKey, Path rvt, Path ifc, Progress progress) throws IOException, InterruptedException {
        if (!available()) throw new Failure("La conversión con Autodesk no está configurada.");
        ensureBucket();
        String objectId = upload(objectKey, rvt);
        String urn = Base64.getUrlEncoder().withoutPadding().encodeToString(objectId.getBytes(StandardCharsets.UTF_8));
        progress.report(Status.TRANSLATING, "Autodesk recibió el RVT; empieza la conversión a IFC…");
        startJob(urn);
        String derivative = await(urn, progress);
        download(urn, derivative, ifc);
    }

    private synchronized String token() throws IOException, InterruptedException {
        if (token != null && Instant.now().isBefore(tokenUntil)) return token;
        String basic = Base64.getEncoder().encodeToString((clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
        String form = "grant_type=client_credentials&scope=" + URLEncoder.encode(SCOPES, StandardCharsets.UTF_8);
        var response = http.send(HttpRequest.newBuilder(base.resolve("authentication/v2/token")).timeout(Duration.ofSeconds(30))
            .header("Authorization", "Basic " + basic).header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json").POST(HttpRequest.BodyPublishers.ofString(form)).build(),
            HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 400 || response.statusCode() == 401 || response.statusCode() == 403)
            throw new Failure("Autodesk rechazó las credenciales: revisa APS_CLIENT_ID y APS_CLIENT_SECRET.");
        check(response, "Autodesk no entregó el acceso");
        var body = json.readTree(response.body());
        String access = body.path("access_token").asText("");
        if (access.isEmpty()) throw new Failure("Autodesk no entregó el acceso.");
        long seconds = body.path("expires_in").asLong(3599);
        token = access;
        tokenUntil = Instant.now().plusSeconds(Math.max(0, seconds - 120));
        return token;
    }

    private HttpRequest.Builder aps(String path) throws IOException, InterruptedException {
        return HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(60)).header("Authorization", "Bearer " + token());
    }

    private void ensureBucket() throws IOException, InterruptedException {
        if (bucketReady) return;
        var body = json.writeValueAsString(Map.of("bucketKey", bucket, "policyKey", "transient"));
        var response = http.send(aps("oss/v2/buckets").header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 409) check(response, "No se pudo crear el bucket de Autodesk");
        bucketReady = true;
    }

    private String upload(String objectKey, Path rvt) throws IOException, InterruptedException {
        long size = Files.size(rvt);
        int parts = size > SINGLE_PART ? (int) ((size + PART - 1) / PART) : 1;
        String path = "oss/v2/buckets/" + bucket + "/objects/" + URLEncoder.encode(objectKey, StandardCharsets.UTF_8) + "/signeds3upload";
        var signed = http.send(aps(path + "?parts=" + parts + "&minutesExpiration=60").GET().build(), HttpResponse.BodyHandlers.ofString());
        if (signed.statusCode() == 403)
            throw new Failure("Autodesk no permite subir al bucket «" + bucket + "»: puede pertenecer a otra aplicación; define APS_BUCKET.");
        check(signed, "Autodesk no preparó la subida del RVT");
        var grant = json.readTree(signed.body());
        String uploadKey = grant.path("uploadKey").asText("");
        var urls = grant.path("urls");
        if (uploadKey.isEmpty() || urls.size() < parts) throw new Failure("Autodesk no preparó la subida del RVT.");
        for (int i = 0; i < parts; i++) {
            long offset = i * PART, length = parts == 1 ? size : Math.min(PART, size - offset);
            HttpRequest.BodyPublisher bytes = parts == 1 ? HttpRequest.BodyPublishers.ofFile(rvt)
                : HttpRequest.BodyPublishers.ofByteArray(slice(rvt, offset, (int) length));
            var put = http.send(HttpRequest.newBuilder(URI.create(urls.get(i).asText())).timeout(Duration.ofMinutes(30))
                .PUT(bytes).build(), HttpResponse.BodyHandlers.discarding());
            check(put, "La subida del RVT a Autodesk falló");
        }
        var done = http.send(aps(path).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("uploadKey", uploadKey)))).build(),
            HttpResponse.BodyHandlers.ofString());
        check(done, "Autodesk no cerró la subida del RVT");
        String objectId = json.readTree(done.body()).path("objectId").asText("");
        if (objectId.isEmpty()) throw new Failure("Autodesk no confirmó la subida del RVT.");
        return objectId;
    }

    private static byte[] slice(Path file, long offset, int length) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            in.skipNBytes(offset);
            return in.readNBytes(length);
        }
    }

    private void startJob(String urn) throws IOException, InterruptedException {
        var body = json.writeValueAsString(Map.of("input", Map.of("urn", urn),
            "output", Map.of("formats", List.of(Map.of("type", "ifc")))));
        var response = http.send(aps("modelderivative/v2/designdata/job").header("Content-Type", "application/json")
            .header("x-ads-force", "true").POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            String diagnostic = detail(response.body());
            throw new Failure("Autodesk no aceptó la conversión (HTTP " + response.statusCode() + ")" + (diagnostic.isEmpty() ? "." : ": " + diagnostic));
        }
    }

    /** Polls the manifest until the job ends; returns the URN of the IFC resource. */
    private String await(String urn, Progress progress) throws IOException, InterruptedException {
        Instant end = Instant.now().plus(deadline);
        String last = "";
        while (true) {
            var response = http.send(aps("modelderivative/v2/designdata/" + urn + "/manifest").GET().build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 404) {
                check(response, "Autodesk no informó el estado de la conversión");
                var manifest = json.readTree(response.body());
                String status = manifest.path("status").asText("");
                if (status.equals("success")) {
                    String found = ifcResource(manifest);
                    if (found == null) throw new Failure("Autodesk terminó, pero no entregó un IFC." + messages(manifest));
                    return found;
                }
                if (status.equals("failed") || status.equals("timeout"))
                    throw new Failure("Autodesk no pudo convertir el RVT" + (status.equals("timeout") ? " a tiempo." : ".") + messages(manifest));
                String percent = manifest.path("progress").asText("");
                String text = "Autodesk está convirtiendo el modelo a IFC" + (percent.isEmpty() ? "…" : " (" + percent + ")…");
                if (!text.equals(last)) { progress.report(Status.TRANSLATING, text); last = text; }
            }
            if (Instant.now().isAfter(end)) throw new Failure("La conversión tardó más de " + deadline.toMinutes() + " minutos; vuelve a intentarlo más tarde.");
            Thread.sleep(poll.toMillis());
        }
    }

    /** The URN of the IFC file among the derivatives with output type «ifc». */
    static String ifcResource(JsonNode manifest) {
        for (var derivative : manifest.path("derivatives")) {
            if (!derivative.path("outputType").asText("").equalsIgnoreCase("ifc")) continue;
            String found = resource(derivative);
            if (found != null) return found;
        }
        return null;
    }

    private static String resource(JsonNode node) {
        String urn = node.path("urn").asText("");
        if (!urn.isEmpty() && (node.path("role").asText("").equalsIgnoreCase("ifc") || urn.toLowerCase(Locale.ROOT).endsWith(".ifc")))
            return urn;
        for (var child : node.path("children")) {
            String found = resource(child);
            if (found != null) return found;
        }
        return null;
    }

    /** The error and warning texts the manifest carries, for the person to see why. */
    private static String messages(JsonNode manifest) {
        var texts = new ArrayList<String>();
        collect(manifest, texts);
        return texts.isEmpty() ? "" : " " + String.join(" ", texts.stream().distinct().limit(3).toList());
    }

    private static void collect(JsonNode node, List<String> texts) {
        for (var message : node.path("messages")) {
            String text = message.path("message").isArray() ? message.path("message").path(0).asText("") : message.path("message").asText("");
            if (!text.isBlank() && !message.path("type").asText("").equalsIgnoreCase("info")) texts.add(trim(text));
        }
        for (var child : node.path("derivatives")) collect(child, texts);
        for (var child : node.path("children")) collect(child, texts);
    }

    private void download(String urn, String derivative, Path ifc) throws IOException, InterruptedException {
        String path = "modelderivative/v2/designdata/" + urn + "/manifest/" + URLEncoder.encode(derivative, StandardCharsets.UTF_8) + "/signedcookies";
        var signed = http.send(aps(path).GET().build(), HttpResponse.BodyHandlers.ofString());
        check(signed, "Autodesk no entregó el enlace del IFC");
        String url = json.readTree(signed.body()).path("url").asText("");
        if (url.isEmpty()) throw new Failure("Autodesk no entregó el enlace del IFC.");
        String cookies = String.join("; ", signed.headers().allValues("set-cookie").stream()
            .map(cookie -> cookie.split(";", 2)[0].strip()).filter(cookie -> !cookie.isEmpty()).toList());
        var request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofMinutes(30)).GET();
        if (!cookies.isEmpty()) request.header("Cookie", cookies);
        var response = http.send(request.build(), HttpResponse.BodyHandlers.ofFile(ifc));
        if (response.statusCode() / 100 != 2) throw new Failure("La descarga del IFC desde Autodesk falló (HTTP " + response.statusCode() + ").");
    }

    private void check(HttpResponse<?> response, String what) {
        int code = response.statusCode();
        if (code / 100 == 2) return;
        if (code == 401 || code == 403) throw new Failure(what + ": Autodesk negó el acceso (HTTP " + code + "). Revisa los permisos de la aplicación de APS.");
        if (code == 429) throw new Failure(what + ": Autodesk limitó las solicitudes; inténtalo en unos minutos.");
        String diagnostic = response.body() instanceof String text ? detail(text) : "";
        throw new Failure(what + " (HTTP " + code + ")" + (diagnostic.isEmpty() ? "." : ": " + diagnostic));
    }

    /** The «diagnostic» or «reason» APS puts in an error body, short. */
    private String detail(String body) {
        try {
            var tree = json.readTree(body);
            for (String field : List.of("diagnostic", "reason", "developerMessage", "errorMessage")) {
                String text = tree.path(field).asText("");
                if (!text.isBlank()) return trim(text);
            }
        } catch (IOException | RuntimeException ignored) { /* Not JSON. */ }
        return "";
    }

    private static String trim(String text) {
        String clean = text.strip().replaceAll("\\s+", " ");
        return clean.length() > 200 ? clean.substring(0, 200) + "…" : clean;
    }
}
