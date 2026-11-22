package com.obracota.infrastructure.knowledge.adapters.out;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.knowledge.port.CitationCodec;
import com.obracota.application.knowledge.port.SpecificationPassages.Passage;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** {@link CitationCodec} with Jackson. A reply wrapped in a Markdown code fence is unwrapped first. */
public class JacksonCitationCodec implements CitationCodec {
    private final ObjectMapper json;

    public JacksonCitationCodec(ObjectMapper json) { this.json = json; }

    @Override
    public String evidence(String question, List<Passage> passages) {
        try {
            return json.writeValueAsString(Map.of("question", question, "passages", passages));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The evidence could not be written as JSON", e);
        }
    }

    @Override
    public Optional<Citation> citation(String reply) {
        var raw = reply.strip().replaceFirst("^\u0060\u0060\u0060(?:json)?\\s*", "").replaceFirst("\\s*\u0060\u0060\u0060$", "");
        try {
            var parsed = json.readTree(raw);
            if (parsed == null) return Optional.empty();
            return Optional.of(new Citation(parsed.path("answer").asText("").strip(), parsed.path("page").asInt(),
                parsed.path("quote").asText("").strip()));
        } catch (JsonProcessingException invalid) {
            return Optional.empty(); // No verifiable citation.
        }
    }
}
