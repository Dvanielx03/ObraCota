package com.obracota.infrastructure.knowledge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.designoption.GenerateOptions.ProviderFailure;
import com.obracota.application.knowledge.port.SpecificationPassages.Answer;
import com.obracota.application.knowledge.port.SpecificationPassages.Passage;
import com.obracota.application.knowledge.usecase.AskDocument;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.ChatModelPort;
import com.obracota.infrastructure.knowledge.adapters.out.JacksonCitationCodec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import static com.obracota.infrastructure.knowledge.AskDocumentTest.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

class DuplexDocumentEvaluationTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ORIGINAL_SHA256 = "a47f6e4fc343294573220c5bcfe961717d14e93416bb604133c2a091fce67e33";

    record Example(String id, String question, Integer page, String quote, String answer) {}
    record Assessment(boolean citationCorrect, boolean supported) {}

    @TestFactory Stream<DynamicTest> documentAnswersAgainstTheOriginalPdf() throws Exception {
        var location = System.getenv("OBRACOTA_EVAL_PDF");
        assumeTrue(location != null && !location.isBlank(), "Indica la ficha del Duplex con OBRACOTA_EVAL_PDF");
        var bytes = Files.readAllBytes(Path.of(location));
        assertEquals(ORIGINAL_SHA256, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
        List<Example> cases;
        try (var fixture = getClass().getResourceAsStream("/knowledge/duplex-evaluation.json")) {
            assertNotNull(fixture);
            cases = JSON.readValue(fixture, new TypeReference<>() {});
        }
        var pages = pages(bytes);
        var proof = cases.stream().map(example -> dynamicTest(example.id(), () -> {
            var source = example.page() == null ? null : pages.get(example.page() - 1);
            if (source != null) assertTrue(source.content().contains(example.quote()), "La cita debe existir literalmente en el PDF original");
            var answer = run(example, pages, source == null ? Map.of() : Map.of(
                "answer", example.answer(), "page", example.page(), "quote", example.quote()));
            if (source == null) {
                assertEquals("INSUFFICIENT", answer.status());
                assertTrue(answer.evidence().isEmpty());
            } else {
                assertEquals(new Assessment(true, true), assess(example, pages, answer));
            }
        }));
        var first = cases.getFirst();
        var invalid = Stream.of(
            dynamicTest("rechaza página incorrecta", () -> assertEquals("INSUFFICIENT", run(first, pages, Map.of(
                "page", 14, "quote", first.quote(), "answer", first.answer())).status())),
            dynamicTest("rechaza cita inventada", () -> assertEquals("INSUFFICIENT", run(first, pages, Map.of(
                "page", first.page(), "quote", "Certificado de resistencia EI 60 de la puerta de Duplex", "answer", first.answer())).status())),
            dynamicTest("una cita literal no respalda otra conclusión", () -> {
                var answer = run(first, pages, Map.of(
                    "page", first.page(), "quote", first.quote(), "answer", "La puerta instalada lleva laca blanca."));
                assertEquals(new Assessment(true, false), assess(first, pages, answer));
            })
        );
        return Stream.concat(proof, invalid);
    }

    private static List<Passage> pages(byte[] bytes) throws Exception {
        try (var pdf = Loader.loadPDF(bytes)) {
            var stripper = new PDFTextStripper();
            var passages = new ArrayList<Passage>();
            for (int page = 1; page <= pdf.getNumberOfPages(); page++) {
                stripper.setStartPage(page);
                stripper.setEndPage(page);
                var text = stripper.getText(pdf).replaceAll("[\\p{Cntrl}\\s]+", " ").strip();
                passages.add(new Passage(page, 1, text));
            }
            return List.copyOf(passages);
        }
    }

    private static Answer run(Example example, List<Passage> pages, Map<String, Object> providerReply) throws Exception {
        var store = new Store();
        // Pin the source page for this evaluator so it measures grounding separately from pgvector ranking.
        store.evidence = List.of(pages.get(example.page() == null ? 0 : example.page() - 1));
        var serialized = JSON.writeValueAsString(providerReply);
        ChatModelPort fake = (model, prompt) -> {
            assertTrue(prompt.contains(JSON.valueToTree(example.question()).toString()));
            return new ChatModelPort.Reply(serialized, new Consumption(0, 0, 0));
        };
        var assistant = new AskDocument(catalog(true), store, new JacksonCitationCodec(JSON), fake,
            (model, texts) -> { throw new ProviderFailure("EVALUATION_LOCAL"); }, new Journal(),
            new AiBudget(new Month(), 800, Clock.systemUTC()), DIRECT, "local-test", "local-test");
        return assistant.ask(PROJECT, USER, DOCUMENT, example.question());
    }

    private static Assessment assess(Example expected, List<Passage> pages, Answer result) {
        if (!"ANSWERED".equals(result.status()) || result.evidence().size() != 1) return new Assessment(false, false);
        var evidence = result.evidence().getFirst();
        boolean correct = expected.page().equals(evidence.page())
            && pages.get(evidence.page() - 1).content().contains(evidence.quote());
        boolean supported = correct && evidence.quote().contains(expected.quote())
            && expected.answer().equalsIgnoreCase(result.answer().strip());
        return new Assessment(correct, supported);
    }
}
