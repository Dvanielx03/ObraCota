package com.obracota.application.knowledge.port;

import java.util.List;
import java.util.Optional;

/** Writes the evidence sent to the chat model and reads the citation it answers with. */
public interface CitationCodec {
    record Citation(String answer, int page, String quote) {}

    /** The question and the passages as one JSON document, appended to the instructions. */
    String evidence(String question, List<SpecificationPassages.Passage> passages);

    /** The citation in the model's reply, or empty when the reply is not a JSON object. */
    Optional<Citation> citation(String reply);
}
