package com.obracota.application.knowledge.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** The PDF specifications of a project split into passages, with their embeddings and the answers given about them. */
public interface SpecificationPassages {
    record Source(UUID id, String filename, UUID version, String model, int revision, String element) {}

    record Passage(int page, int offset, String content) {}

    record Evidence(int page, String quote) {}

    record Answer(String status, String answer, List<Evidence> evidence, String retrieval) {}

    List<Source> sources(UUID project);

    boolean belongs(UUID project, UUID document);

    /** The last ten answered questions about the document, newest first. */
    List<Map<String, Object>> history(UUID document);

    /** Splits the extracted pages of the document into passages (once) and returns how many it has. */
    int split(UUID document);

    /** Records the question before any provider call; its answer stays empty until {@link #answer}. */
    void ask(UUID id, UUID document, String question);

    /** Up to 16 passages without an embedding of {@code model}, the lexically closest to the question first. */
    List<Passage> unembedded(UUID document, String model, String question);

    void embed(UUID document, Passage passage, float[] vector, String model);

    /** The six best passages by lexical and, when {@code vector} is not null, vector rank fusion. */
    List<Passage> ranked(UUID document, String question, String model, float[] vector);

    void answer(UUID id, Answer answer);
}
