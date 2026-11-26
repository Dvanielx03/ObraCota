package com.obracota.infrastructure.knowledge.adapters.out;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.designoption.GenerateOptions.ProviderFailure;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.ChatModelPort;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class LocalDocumentModels {
    public static final String EMBEDDING = "embeddinggemma:300m-qat-q4_0";
    public static final String CHAT = "qwen2.5:0.5b-instruct";
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final ObjectMapper json;
    private final String endpoint;
    private final String keepAlive;

    public LocalDocumentModels(ObjectMapper json, @Value("${DOCUMENT_OLLAMA_URL:}") String endpoint,
                               @Value("${DOCUMENT_OLLAMA_KEEP_ALIVE:30m}") String keepAlive) {
        this.json = json;
        this.endpoint = endpoint;
        this.keepAlive = keepAlive;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void warmOnStartup() {
        if (enabled()) Thread.startVirtualThread(this::warm);
    }

    void warm() {
        warm("/api/embed", Map.of("model", EMBEDDING, "input", "inicio"));
        warm("/api/chat", Map.of("model", CHAT, "messages", List.of(), "stream", false,
            "options", Map.of("num_ctx", 4096)));
    }

    private void warm(String path, Map<String, Object> body) {
        try { call(path, body); }
        catch (ProviderFailure ignored) { /* A normal request can retry when Ollama is available. */ }
    }

    public boolean enabled() { return !endpoint.isBlank(); }

    public List<float[]> embedQuery(String model, List<String> texts) {
        return embed(model, texts, "task: search result | query: ");
    }

    public List<float[]> embedPassages(List<String> texts) {
        return embed(EMBEDDING, texts, "title: none | text: ");
    }

    private List<float[]> embed(String model, List<String> texts, String prefix) {
        if (!EMBEDDING.equals(model)) throw new ProviderFailure("WRONG_EMBEDDING_MODEL");
        var response = call("/api/embed", Map.of("model", model, "input", texts.stream().map(prefix::concat).toList(), "truncate", false));
        var vectors = new ArrayList<float[]>();
        if (!model.equals(response.path("model").asText())) throw new ProviderFailure("WRONG_EMBEDDING_MODEL");
        for (var values : response.path("embeddings")) {
            if (values.size() != 768) throw new ProviderFailure("INVALID_EMBEDDING");
            var vector = new float[768];
            for (int i = 0; i < vector.length; i++) {
                vector[i] = values.get(i).floatValue();
                if (!values.get(i).isNumber() || !Float.isFinite(vector[i])) throw new ProviderFailure("INVALID_EMBEDDING");
            }
            vectors.add(vector);
        }
        if (vectors.size() != texts.size()) throw new ProviderFailure("INVALID_EMBEDDING");
        return vectors;
    }

    /** A reply in the order answer, quote, page. */
    public ChatModelPort.Reply complete(String model, String prompt) {
        return complete(model, prompt, List.of("answer", "quote", "page"));
    }

    /** A second reading that copies the quote before answering: the assistant asks it when the first reply fails its checks. */
    public ChatModelPort.Reply completeQuoteFirst(String model, String prompt) {
        return complete(model, prompt, List.of("quote", "answer", "page"));
    }

    /**
     * The JSON schema fixes the order in which the model writes the fields (Ollama turns it into a grammar), so it is
     * built with ordered maps: the same question always meets the same prompt and grammar.
     */
    private ChatModelPort.Reply complete(String model, String prompt, List<String> order) {
        var properties = new LinkedHashMap<String, Object>();
        for (var field : order) properties.put(field, Map.of("type", "page".equals(field) ? "integer" : "string"));
        var format = new LinkedHashMap<String, Object>();
        format.put("type", "object");
        format.put("properties", properties);
        format.put("required", order);
        format.put("additionalProperties", false);
        var response = call("/api/chat", Map.of("model", model, "stream", false, "format", format,
            "messages", List.of(Map.of("role", "user", "content", prompt)),
            "options", Map.of("temperature", 0, "num_ctx", 4096, "num_predict", 144)));
        int input = response.path("prompt_eval_count").asInt();
        int generated = response.path("eval_count").asInt();
        return new ChatModelPort.Reply(response.at("/message/content").asText(), new Consumption(input, generated, input + generated));
    }

    private JsonNode call(String path, Map<String, Object> body) {
        if (!enabled()) throw new ProviderFailure("LOCAL_MODEL_NOT_CONFIGURED");
        var payload = new LinkedHashMap<>(body);
        payload.put("keep_alive", keepAlive);
        try {
            var request = HttpRequest.newBuilder(URI.create(endpoint + path)).timeout(Duration.ofSeconds(110))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(payload))).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() != 200) throw new ProviderFailure("HTTP_" + response.statusCode());
            return json.readTree(response.body());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ProviderFailure("INTERRUPTED");
        } catch (IOException ex) {
            throw new ProviderFailure("LOCAL_MODEL_UNAVAILABLE");
        }
    }
}
