package com.obracota.infrastructure.agent.adapters.out.ai;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.obracota.domain.agent.port.service.AgentModelPort;
import com.obracota.domain.airun.Consumption;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

/**
 * {@link AgentModelPort} on Gemini's {@code generateContent} (v1beta) with function calling, without SDK (PROPUESTA
 * §3.1). The key is the server's ({@code GEMINI_API_KEY}); it travels in {@code x-goog-api-key}, never in the URL.
 * <p>
 * Thought signatures: a model turn is sent back exactly as it came ({@code candidates[0].content}, kept in
 * {@link Message#raw()}), so every {@code thoughtSignature} returns unchanged, in its place, on the next step; omitting
 * them is a 400. Any answer other than 200 is a {@link Failure} {@code HTTP_<status>} and is never retried here.
 * <p>
 * With {@code localOnly} (test profiles) the adapter refuses any base URL that is not the local machine, so an
 * automated test can never reach {@code googleapis.com}.
 */
public final class GeminiAgentModelAdapter implements AgentModelPort {
    public static final URI ENDPOINT = URI.create("https://generativelanguage.googleapis.com/v1beta/models/");
    static final int MAX_OUTPUT_TOKENS = 1024;
    private static final Set<String> LOCAL = Set.of("localhost", "127.0.0.1", "[::1]", "::1");

    private final ObjectMapper json;
    private final String key;
    private final URI endpoint;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final Duration timeout;

    public GeminiAgentModelAdapter(ObjectMapper json, String key, URI endpoint, boolean localOnly) {
        this(json, key, endpoint, localOnly, Duration.ofSeconds(60));
    }

    public GeminiAgentModelAdapter(ObjectMapper json, String key, URI endpoint, boolean localOnly, Duration timeout) {
        if (localOnly && (endpoint.getHost() == null || !LOCAL.contains(endpoint.getHost())))
            throw new IllegalArgumentException("Test profiles only call a local model endpoint, not " + endpoint.getHost());
        this.json = json;
        this.key = key == null ? "" : key;
        this.endpoint = endpoint;
        this.timeout = timeout;
    }

    @Override public String provider() { return "gemini"; }

    @Override public boolean paid() { return true; }

    @Override public boolean configured() { return !key.isBlank(); }

    @Override
    public Turn next(Request request) {
        var body = body(request);
        JsonNode answer;
        try {
            var http = HttpRequest.newBuilder(URI.create(endpoint + request.model() + ":generateContent"))
                .timeout(timeout).header("x-goog-api-key", key).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body))).build();
            var response = client.send(http, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() != 200) throw new Failure("HTTP_" + response.statusCode());
            answer = json.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Failure("INTERRUPTED");
        } catch (IOException e) {
            throw new Failure("NETWORK_ERROR");
        }
        var usage = usage(answer);
        var content = answer.path("candidates").path(0).path("content");
        if (!content.isObject() || !content.path("parts").isArray()) throw new Failure("NO_CONTENT", usage);
        var parts = new ArrayList<Part>();
        for (var part : content.path("parts")) {
            if (part.has("functionCall")) {
                var call = part.get("functionCall");
                Map<String, Object> args = call.path("args").isObject()
                    ? json.convertValue(call.get("args"), new TypeReference<LinkedHashMap<String, Object>>() {}) : Map.of();
                parts.add(new Call(call.path("id").isTextual() ? call.get("id").asText() : null, call.path("name").asText(""), args));
            } else if (part.has("text") && !part.path("thought").asBoolean()) {
                parts.add(new Text(part.get("text").asText()));
            }
        }
        String raw;
        try {
            raw = json.writeValueAsString(content);
        } catch (IOException e) {
            throw new Failure("NO_CONTENT", usage);
        }
        return new Turn(new Message(Role.MODEL, parts, raw), usage);
    }

    ObjectNode body(Request request) {
        var body = json.createObjectNode();
        body.putObject("systemInstruction").putArray("parts").addObject().put("text", request.system());
        var contents = body.putArray("contents");
        for (var message : request.history()) contents.add(content(message));
        var declarations = body.putArray("tools").addObject().putArray("functionDeclarations");
        for (var tool : request.tools()) {
            var declaration = declarations.addObject();
            declaration.put("name", tool.name());
            declaration.put("description", tool.description());
            declaration.set("parameters", json.valueToTree(tool.parameters()));
        }
        body.putObject("toolConfig").putObject("functionCallingConfig").put("mode", "AUTO");
        body.putObject("generationConfig").put("maxOutputTokens", MAX_OUTPUT_TOKENS);
        return body;
    }

    private JsonNode content(Message message) {
        if (message.raw() != null) {
            try {
                return json.readTree(message.raw());
            } catch (IOException e) {
                throw new IllegalStateException("A model turn could not be read back", e);
            }
        }
        var node = json.createObjectNode();
        node.put("role", message.role() == Role.MODEL ? "model" : "user");
        ArrayNode parts = node.putArray("parts");
        for (var part : message.parts()) {
            switch (part) {
                case Text text -> parts.addObject().put("text", text.text());
                case Response response -> {
                    var out = parts.addObject().putObject("functionResponse");
                    if (response.id() != null) out.put("id", response.id());
                    out.put("name", response.name());
                    out.set("response", json.valueToTree(response.result()));
                }
                case Call call -> {
                    var out = parts.addObject().putObject("functionCall");
                    if (call.id() != null) out.put("id", call.id());
                    out.put("name", call.name());
                    out.set("args", json.valueToTree(call.args()));
                }
            }
        }
        return node;
    }

    private static Consumption usage(JsonNode answer) {
        var usage = answer.path("usageMetadata");
        return new Consumption(count(usage, "promptTokenCount"), count(usage, "candidatesTokenCount"), count(usage, "totalTokenCount"));
    }

    private static Integer count(JsonNode usage, String field) { return usage.path(field).isNumber() ? usage.get(field).intValue() : null; }
}
