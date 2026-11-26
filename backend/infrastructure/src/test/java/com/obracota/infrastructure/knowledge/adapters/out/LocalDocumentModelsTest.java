package com.obracota.infrastructure.knowledge.adapters.out;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class LocalDocumentModelsTest {
    @Test void warmupAndChatSendTheConfiguredKeepAlive() throws Exception {
        var json = new ObjectMapper();
        var requests = new CopyOnWriteArrayList<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api", exchange -> {
            try (exchange) {
                var body = json.readTree(exchange.getRequestBody());
                requests.add(exchange.getRequestURI().getPath() + ":" + body.path("keep_alive").asText());
                var response = "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            }
        });
        server.start();
        try {
            var models = new LocalDocumentModels(json, "http://127.0.0.1:" + server.getAddress().getPort(), "12m");
            models.warm();
            models.complete(LocalDocumentModels.CHAT, "Prueba");
            assertEquals(java.util.List.of("/api/embed:12m", "/api/chat:12m", "/api/chat:12m"), requests);
        } finally { server.stop(0); }
    }
}
