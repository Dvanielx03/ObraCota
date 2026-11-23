package com.obracota.infrastructure.designchange;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.domain.designchange.DoorInspectionPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.*;
import java.net.http.*;
import java.time.Duration;
import java.util.UUID;

/** The engine's {@code GET /inspect} (pre-H1 contract: errors are {@code {"detail": ...}}). */
@Component
class HttpDoorInspection implements DoorInspectionPort {
    private final String engine;
    private final ObjectMapper json;
    private final String token;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    HttpDoorInspection(@Value("${IFC_ENGINE_URL:http://localhost:8000}") String engine, ObjectMapper json,
                @Value("${ENGINE_TOKEN:}") String token) {
        this.engine = engine;
        this.json = json;
        this.token = token == null ? "" : token.strip();
    }

    public Door inspect(UUID project, UUID version, String element) throws IOException {
        try (var response = request(project, version, element)) {
            return json.readValue(response, Door.class);
        }
    }

    private InputStream request(UUID project, UUID version, String element) throws IOException {
        var path = UriComponentsBuilder.fromUriString(engine).path("/inspect")
            .queryParam("project", project).queryParam("version", version).queryParam("element", element);
        var request = HttpRequest.newBuilder(path.build().encode().toUri()).timeout(Duration.ofMinutes(2));
        if (!token.isEmpty()) request.header("Authorization", "Bearer " + token);
        try {
            var response = client.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() == 200) return response.body();
            try (var body = response.body()) {
                var message = json.readTree(body.readNBytes(4096)).path("detail").asText("El motor IFC rechazó la operación.");
                throw new ResponseStatusException(response.statusCode() == 404 ? HttpStatus.NOT_FOUND : HttpStatus.UNPROCESSABLE_ENTITY, message);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "La revisión IFC se interrumpió.");
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "El motor IFC no está disponible en este momento.", e);
        }
    }
}
