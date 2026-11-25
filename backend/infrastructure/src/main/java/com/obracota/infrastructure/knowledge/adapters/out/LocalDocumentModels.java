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
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LocalDocumentModels {
    public static final String EMBEDDING = "embeddinggemma:300m-qat-q4_0";
    public static final String CHAT = "qwen2.5:0.5b-instruct";
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final ObjectMapper json;
    private final String endpoint;

    public LocalDocumentModels(ObjectMapper json, @Value("${DOCUMENT_OLLAMA_URL:}") String endpoint) {
        this.json = json;
        this.endpoint = endpoint;
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

    public ChatModelPort.Reply complete(String model, String prompt) {
        var format = Map.of("type", "object", "additionalProperties", false,
            "properties", Map.of("answer", Map.of("type", "string"), "quote", Map.of("type", "string"),
                "page", Map.of("type", "integer")),
            "required", List.of("answer", "quote", "page"));
        var response = call("/api/chat", Map.of("model", model, "stream", false, "format", format,
            "messages", List.of(Map.of("role", "user", "content", prompt)),
            "options", Map.of("temperature", 0, "num_ctx", 4096, "num_predict", 144)));
        int input = response.path("prompt_eval_count").asInt();
        int generated = response.path("eval_count").asInt();
        return new ChatModelPort.Reply(response.at("/message/content").asText(), new Consumption(input, generated, input + generated));
    }

    private JsonNode call(String path, Object body) {
        if (!enabled()) throw new ProviderFailure("LOCAL_MODEL_NOT_CONFIGURED");
        try {
            var request = HttpRequest.newBuilder(URI.create(endpoint + path)).timeout(Duration.ofSeconds(110))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body))).build();
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
