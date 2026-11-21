package com.obracota.infrastructure.designchange;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.domain.designchange.BimEditPort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.*;
import java.net.http.*;
import java.time.Duration;
import java.util.UUID;

@Component
class HttpBimEdit implements BimEditPort {
    private final String engine;
    private final ObjectMapper json;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    HttpBimEdit(@Value("${IFC_ENGINE_URL:http://localhost:8000}") String engine, ObjectMapper json) {
        this.engine = engine;
        this.json = json;
    }

    public Door inspect(UUID project, UUID version, String element) throws IOException {
        try (var response = request(project, version, element, null)) {
            return json.readValue(response, Door.class);
        }
    }

    public InputStream apply(UUID project, UUID version, String element, String typeId) throws IOException {
        return request(project, version, element, typeId);
    }

    private InputStream request(UUID project, UUID version, String element, String typeId) throws IOException {
        var path = UriComponentsBuilder.fromUriString(engine).path(typeId == null ? "/inspect" : "/apply")
            .queryParam("project", project).queryParam("version", version).queryParam("element", element);
        if (typeId != null) path.queryParam("type_id", typeId);
        var request = HttpRequest.newBuilder(path.build().encode().toUri()).timeout(Duration.ofMinutes(2));
        if (typeId != null) request.POST(HttpRequest.BodyPublishers.noBody());
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
