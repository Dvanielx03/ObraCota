package com.obracota.application.knowledge.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** The PDF specifications of a project split into passages, with their embeddings and the answers given about them. */
public interface SpecificationPassages {
    record Source(UUID id, String filename, UUID version, String model, int revision, String element,
                  String status, String error, boolean originalAvailable, int ocrPages) {}

    record Index(String status, String model) {}

    record Passage(int page, int offset, String content, String section) {
        public Passage(int page, int offset, String content) { this(page, offset, content, null); }
    }

    /**
     * A quote verified verbatim against the indexed text of {@code document}, with its page, section (when the PDF has
     * one) and the measurement it states ({@code datum}, e.g. «28 MPa») when there is one.
     */
    record Evidence(int page, String quote, String section, UUID document, String filename, String datum) {
        public Evidence(int page, String quote) { this(page, quote, null, null, null, null); }
        public Evidence(int page, String quote, String section) { this(page, quote, section, null, null, null); }
    }

    /**
     * {@code status}: ANSWERED, DISCREPANCY (authorised sources disagree; every one is cited), INSUFFICIENT, NO_SOURCES,
     * INDEX_PENDING, INDEX_FAILED, EMPTY or UNAVAILABLE. {@code omitted} counts the sentences of the PDF left out because
     * they read as instructions to the assistant. {@code version} and {@code element} name the piece a piece question
     * was about.
     */
    record Answer(String status, String answer, List<Evidence> evidence, String retrieval, String datum, int omitted,
                  UUID version, String element) {
        public Answer(String status, String answer, List<Evidence> evidence, String retrieval) {
            this(status, answer, evidence, retrieval, null, 0, null, null);
        }
    }

    List<Source> sources(UUID project);

    boolean belongs(UUID project, UUID document);

    /** Whether the version is one of the project's. */
    default boolean versionBelongs(UUID project, UUID version) { throw new UnsupportedOperationException(); }

    /** The specifications linked to one piece of one version of the project, in any index state. */
    default List<Source> piece(UUID project, UUID version, String element) { throw new UnsupportedOperationException(); }

    /** The last ten answered questions about the piece (including older questions about one of its documents). */
    default List<Map<String, Object>> pieceHistory(UUID version, String element) { throw new UnsupportedOperationException(); }

    /** Records a question about a piece before any provider call. */
    default void askPiece(UUID id, UUID version, String element, String question) { throw new UnsupportedOperationException(); }

    default Index index(UUID document) { return new Index("LEGACY", null); }

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
