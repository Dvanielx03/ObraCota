package com.obracota.infrastructure.knowledge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.airun.port.AiRunJournal;
import com.obracota.application.airun.port.BudgetReservationPort;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.designoption.GenerateOptions.ProviderFailure;
import com.obracota.application.knowledge.port.SpecificationPassages;
import com.obracota.application.knowledge.usecase.AskDocument;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.ChatModelPort;
import com.obracota.domain.knowledge.port.service.EmbeddingPort;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.infrastructure.knowledge.adapters.out.JacksonCitationCodec;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.YearMonth;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * R3.2: the document assistant as a use case, without a database or a provider. The pgvector SQL stays in
 * {@code PassageAdapter}; this pins the flow: owner check, budget before any call, lexical fallback and the citation
 * that must be an exact substring of a retrieved passage.
 */
class AskDocumentTest {
    static final UUID PROJECT = UUID.randomUUID(), USER = UUID.randomUUID(), DOCUMENT = UUID.randomUUID();
    static final SpecificationPassages.Passage PAGE_3 =
        new SpecificationPassages.Passage(3, 1, "La puerta P90 lleva acabado en laca blanca mate.");

    /** Every passage store call, plus what the use case wrote. */
    static final class Store implements SpecificationPassages {
        int passages = 1;
        boolean owned = true;
        final List<UUID> questions = new ArrayList<>();
        final Map<UUID, Answer> answers = new HashMap<>();
        final List<Passage> embedded = new ArrayList<>();
        List<Passage> evidence = List.of(PAGE_3);
        float[] rankedWith;
        @Override public List<Source> sources(UUID project) { return List.of(); }
        @Override public boolean belongs(UUID project, UUID document) { return owned; }
        @Override public List<Map<String, Object>> history(UUID document) { return List.of(); }
        @Override public int split(UUID document) { return passages; }
        @Override public void ask(UUID id, UUID document, String question) { questions.add(id); }
        @Override public List<Passage> unembedded(UUID document, String model, String question) { return List.of(PAGE_3); }
        @Override public void embed(UUID document, Passage passage, float[] vector, String model) { embedded.add(passage); }
        @Override public List<Passage> ranked(UUID document, String question, String model, float[] vector) {
            rankedWith = vector;
            return evidence;
        }
        @Override public void answer(UUID id, Answer answer) { answers.put(id, answer); }
    }

    static final class Journal implements AiRunJournal {
        final List<String> events = new ArrayList<>();
        @Override public UUID start(UUID owner, int slot, String model) { events.add("start:" + model); return UUID.randomUUID(); }
        @Override public void finish(UUID run, Consumption usage) { events.add("finish"); }
        @Override public void fail(UUID run, String error, Consumption usage) { events.add("fail:" + error); }
    }

    static final class Month implements BudgetReservationPort {
        int reserved;
        @Override public void lock() {}
        @Override public int reserved(YearMonth month) { return reserved; }
        @Override public void add(YearMonth month, int cents) { reserved += cents; }
    }

    static final Transactions DIRECT = new Transactions() {
        @Override public <T, E extends Exception> T required(Work<T, E> work) throws E { return work.run(); }
    };

    final Store store = new Store();
    final Journal journal = new Journal();
    final Month month = new Month();
    String reply = "{\"answer\":\"El acabado es laca blanca mate.\",\"page\":3,\"quote\":\"laca blanca mate\"}";
    boolean chatFails, embeddingFails;

    /** A catalog whose project lookup answers «owned» for any project. */
    static ProjectFileCatalog catalog(boolean owner) {
        var projects = (ProjectRepository) Proxy.newProxyInstance(AskDocumentTest.class.getClassLoader(), new Class<?>[]{ProjectRepository.class},
            (proxy, method, args) -> method.getName().startsWith("find") ? (owner ? Optional.of(new Object()) : Optional.empty()) : null);
        return new ProjectFileCatalog(projects, null);
    }

    AskDocument assistant(boolean owner, int cap) {
        ChatModelPort chat = (model, prompt) -> {
            assertTrue(prompt.contains("\"question\"") && prompt.contains("laca blanca"), "the evidence goes as JSON");
            if (chatFails) throw new ProviderFailure("HTTP_503");
            return new ChatModelPort.Reply(reply, new Consumption(10, 5, 15));
        };
        EmbeddingPort embeddings = (model, texts) -> {
            if (embeddingFails) throw new ProviderFailure("HTTP_429");
            return texts.stream().map(t -> new float[]{1f, 0f}).toList();
        };
        return new AskDocument(catalog(owner), store, new JacksonCitationCodec(new ObjectMapper()), chat, embeddings, journal,
            new AiBudget(month, cap, Clock.systemUTC()), DIRECT, "chat-model", "embedding-model");
    }

    @Test void answersWithAQuoteFoundInTheRetrievedPassage() {
        var answer = assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Qué acabado lleva la puerta?");
        assertEquals("ANSWERED", answer.status());
        assertEquals("híbrida", answer.retrieval());
        assertEquals(List.of(new SpecificationPassages.Evidence(3, "laca blanca mate")), answer.evidence());
        assertEquals(5, month.reserved, "each question reserves five cents");
        assertEquals(List.of("start:embedding-model", "finish", "start:chat-model", "finish"), journal.events);
        assertEquals(List.of(PAGE_3), store.embedded);
        assertEquals(answer, store.answers.get(store.questions.getFirst()));
    }

    @Test void aQuoteThatIsNotInThePassageIsInsufficient() {
        reply = "```json\n{\"answer\":\"Lleva roble.\",\"page\":3,\"quote\":\"roble natural\"}\n```";
        assertEquals("INSUFFICIENT", assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?").status());
        reply = "no es JSON";
        assertEquals("INSUFFICIENT", assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?").status());
    }

    @Test void withoutEmbeddingsItFallsBackToLexicalRanking() {
        embeddingFails = true;
        var answer = assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?");
        assertEquals("léxica", answer.retrieval());
        assertNull(store.rankedWith);
        assertEquals("fail:HTTP_429", journal.events.get(1));
        assertEquals("ANSWERED", answer.status());
    }

    @Test void aFailedChatIsUnavailableAndStillRecorded() {
        chatFails = true;
        var answer = assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?");
        assertEquals("UNAVAILABLE", answer.status());
        assertEquals("fail:HTTP_503", journal.events.getLast());
        assertEquals(answer, store.answers.get(store.questions.getFirst()));
    }

    @Test void theBudgetIsCheckedBeforeAnyCall() {
        month.reserved = 796;
        assertThrows(AiBudget.Exhausted.class, () -> assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?"));
        assertTrue(journal.events.isEmpty() && store.questions.isEmpty(), "no provider call and no question stored");
    }

    @Test void emptyPdfsForeignDocumentsAndBadQuestionsCostNothing() {
        store.passages = 0;
        assertEquals("EMPTY", assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?").status());
        store.passages = 1;
        store.owned = false;
        assertThrows(NotFoundApplicationException.class, () -> assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "¿Acabado?"));
        assertThrows(NotFoundApplicationException.class, () -> assistant(false, 800).sources(PROJECT, USER));
        assertThrows(IllegalArgumentException.class, () -> assistant(true, 800).ask(PROJECT, USER, DOCUMENT, " "));
        assertThrows(IllegalArgumentException.class, () -> assistant(true, 800).ask(PROJECT, USER, DOCUMENT, "x".repeat(601)));
        assertEquals(0, month.reserved);
    }
}
