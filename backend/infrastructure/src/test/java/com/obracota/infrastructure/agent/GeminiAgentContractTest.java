package com.obracota.infrastructure.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.agenttools.DesignAgentTools;
import com.obracota.domain.agent.port.service.AgentModelPort.*;
import com.obracota.infrastructure.agent.adapters.out.ai.GeminiAgentModelAdapter;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/**
 * H4 · contract of {@link GeminiAgentModelAdapter} against a local HTTP server (as {@code GeminiContractTest}): the
 * request it builds, the thought signatures it forwards and the 429 it never repeats. No call leaves the machine.
 */
class GeminiAgentContractTest {
    static final String DOOR = "1hOSvn6df7F8_7GcBWlS8Z";
    final ObjectMapper json = new ObjectMapper();
    final List<JsonNode> seen = new CopyOnWriteArrayList<>();
    final List<String> keys = new CopyOnWriteArrayList<>();
    final AtomicInteger hits = new AtomicInteger();
    HttpServer server;

    /** A local Gemini that answers {@code answers} in order (status and body). */
    GeminiAgentModelAdapter serve(List<Map.Entry<Integer, String>> answers) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            int n = hits.getAndIncrement();
            keys.add(exchange.getRequestHeaders().getFirst("x-goog-api-key"));
            seen.add(json.readTree(exchange.getRequestBody()));
            var answer = answers.get(Math.min(n, answers.size() - 1));
            var body = answer.getValue().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(answer.getKey(), body.length);
            try (var out = exchange.getResponseBody()) { out.write(body); }
        });
        server.start();
        return new GeminiAgentModelAdapter(json, "trial", URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"), true);
    }

    @AfterEach void stop() { if (server != null) server.stop(0); }

    static Request request(List<Message> history) {
        return new Request("gemini-test", "system", history, new DesignAgentTools(null, null).declarations());
    }

    static final String SIGNED = """
        {"candidates":[{"content":{"role":"model","parts":[
          {"functionCall":{"id":"fc-1","name":"get_element","args":{"globalId":"%s"}},"thoughtSignature":"c2lnLUE="},
          {"functionCall":{"id":"fc-2","name":"list_types_for","args":{"globalId":"%s"}}},
          {"text":"razonando","thought":true}]}}],
         "usageMetadata":{"promptTokenCount":40,"candidatesTokenCount":5,"totalTokenCount":60}}""".formatted(DOOR, DOOR);

    @Test void declaresAtMostTwelveToolsAndNoneThatPublishes() throws Exception {
        var adapter = serve(List.of(Map.entry(200, SIGNED)));
        adapter.next(request(List.of(Message.user(List.of(new Text("Cambiar FireRating a EI 60")))))) ;
        var body = seen.getFirst();
        var declarations = body.at("/tools/0/functionDeclarations");
        assertTrue(declarations.size() > 0 && declarations.size() <= DesignAgentTools.LIMIT, "declared " + declarations.size());
        for (var declaration : declarations) {
            var name = declaration.get("name").asText();
            assertFalse(name.matches("(?i).*(apply|publish|restore|price|option|approve).*"), name + " must not be declared");
            assertTrue(declaration.path("parameters").path("type").asText().equals("object"), name);
        }
        assertEquals("trial", keys.getFirst(), "the key travels in the header");
        assertEquals("system", body.at("/systemInstruction/parts/0/text").asText());
        assertEquals("AUTO", body.at("/toolConfig/functionCallingConfig/mode").asText());
        assertEquals("user", body.at("/contents/0/role").asText());
    }

    @Test void forwardsThoughtSignaturesUnchangedAndAnswersEachCallById() throws Exception {
        var adapter = serve(List.of(Map.entry(200, SIGNED), Map.entry(200, """
            {"candidates":[{"content":{"role":"model","parts":[{"text":"Listo."}]}}]}""")));
        var history = new ArrayList<Message>();
        history.add(Message.user(List.of(new Text("Cambiar FireRating a EI 60"))));
        var first = adapter.next(request(history));
        assertEquals(List.of("get_element", "list_types_for"), first.calls().stream().map(Call::name).toList());
        assertEquals("fc-1", first.calls().getFirst().id());
        assertEquals(DOOR, first.calls().getFirst().args().get("globalId"));
        assertEquals("", first.text(), "a thought is not the answer");
        assertEquals(60, first.usage().totalTokens());
        history.add(first.message());
        history.add(Message.user(List.of(new Response("fc-1", "get_element", Map.of("status", "OK")),
            new Response("fc-2", "list_types_for", Map.of("status", "OK")))));
        assertEquals("Listo.", adapter.next(request(history)).text());

        var original = json.readTree(SIGNED).at("/candidates/0/content");
        var resent = seen.get(1).at("/contents/1");
        assertEquals(original, resent, "the model turn goes back exactly as it came, signature included");
        assertEquals("c2lnLUE=", resent.at("/parts/0/thoughtSignature").asText());
        assertFalse(resent.at("/parts/1").has("thoughtSignature"), "only the first call of the step carries it");
        var responses = seen.get(1).at("/contents/2/parts");
        assertEquals("fc-1", responses.at("/0/functionResponse/id").asText());
        assertEquals("list_types_for", responses.at("/1/functionResponse/name").asText());
    }

    @Test void aTooManyRequestsEndsTheStepWithoutRepeatingThePaidCall() throws Exception {
        var adapter = serve(List.of(Map.entry(429, "{\"error\":{\"code\":429}}")));
        var failure = assertThrows(Failure.class, () -> adapter.next(request(List.of(Message.user(List.of(new Text("x")))))));
        assertEquals("HTTP_429", failure.code());
        assertEquals(1, hits.get(), "the adapter never retries");
    }

    @Test void testProfilesRefuseARemoteEndpoint() {
        assertThrows(IllegalArgumentException.class,
            () -> new GeminiAgentModelAdapter(json, "trial", GeminiAgentModelAdapter.ENDPOINT, true));
        assertThrows(IllegalArgumentException.class,
            () -> new GeminiAgentModelAdapter(json, "trial", URI.create("http://example.test/"), true));
        assertDoesNotThrow(() -> new GeminiAgentModelAdapter(json, "trial", URI.create("http://localhost:1/"), true));
        assertTrue(new GeminiAgentModelAdapter(json, "", GeminiAgentModelAdapter.ENDPOINT, false).paid());
        assertFalse(new GeminiAgentModelAdapter(json, "", GeminiAgentModelAdapter.ENDPOINT, false).configured());
    }
}
