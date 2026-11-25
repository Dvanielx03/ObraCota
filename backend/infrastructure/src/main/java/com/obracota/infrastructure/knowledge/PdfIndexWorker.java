package com.obracota.infrastructure.knowledge;

import com.obracota.application.airun.port.AiRunJournal;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.designoption.GenerateOptions.ProviderFailure;
import com.obracota.application.knowledge.port.SpecificationPassages.Passage;
import com.obracota.domain.airun.Consumption;
import com.obracota.infrastructure.knowledge.adapters.out.LocalDocumentModels;
import com.obracota.infrastructure.knowledge.adapters.out.PassageAdapter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class PdfIndexWorker {
    private static final Consumption UNKNOWN = new Consumption(null, null, null);
    private final JdbcTemplate db;
    private final Transactions tx;
    private final PassageAdapter passages;
    private final LocalDocumentModels embeddings;
    private final AiRunJournal journal;
    private final Path spool;
    private final Path scannerDb;
    private final boolean scanRequired;

    PdfIndexWorker(JdbcTemplate db, Transactions tx, PassageAdapter passages, LocalDocumentModels embeddings,
                   AiRunJournal journal, @Value("${DOCUMENT_SPOOL_DIR:${java.io.tmpdir}/obracota-pdfs}") String spool,
                   @Value("${DOCUMENT_CLAMAV_DATABASE:}") String scannerDb,
                   @Value("${DOCUMENT_REQUIRE_MALWARE_SCAN:false}") boolean scanRequired) {
        this.db = db;
        this.tx = tx;
        this.passages = passages;
        this.embeddings = embeddings;
        this.journal = journal;
        this.spool = Path.of(spool);
        this.scannerDb = scannerDb.isBlank() ? null : Path.of(scannerDb);
        this.scanRequired = scanRequired;
    }

    private Path file(UUID id) { return spool.resolve(id + ".pdf"); }

    synchronized void stage(UUID id, byte[] bytes) throws IOException {
        Files.createDirectories(spool);
        try (var files = Files.list(spool)) {
            if (files.filter(path -> path.getFileName().toString().endsWith(".pdf")).limit(16).count() >= 16)
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "La cola documental está llena. Intenta más tarde.");
        }
        var pending = Files.createTempFile(spool, "upload-", ".tmp");
        try {
            Files.write(pending, bytes);
            Files.move(pending, file(id));
        } finally { Files.deleteIfExists(pending); }
    }

    void remove(UUID id) throws IOException { Files.deleteIfExists(file(id)); }

    @EventListener(ApplicationReadyEvent.class)
    void recover() {
        // An interrupted provider call may already have been charged. A user can upload again explicitly.
        db.update("update element_specification set index_status='FAILED',index_error='INTERRUPTED' where index_status='PROCESSING'");
    }

    @Scheduled(scheduler = "documentScheduler", fixedDelay = 1500, initialDelay = 3000)
    void runNext() {
        var ids = db.query("select id from element_specification where index_status='QUEUED' order by created_at,id limit 1",
            (row, n) -> row.getObject(1, UUID.class));
        if (ids.isEmpty()) return;
        UUID id = ids.getFirst();
        if (db.update("update element_specification set index_status='PROCESSING' where id=? and index_status='QUEUED'", id) != 1) return;
        try {
            var pages = PdfText.read(file(id), scannerDb, scanRequired);
            if (pages.isEmpty()) throw new PdfText.Rejected("NO_EXTRACTABLE_TEXT");
            var chunks = split(pages);
            var index = vectorize(id, chunks);
            // A visible ready index means its source PDF is already out of the spool.
            remove(id);
            tx.required(() -> {
                for (var page : pages) db.update("""
                    insert into specification_page(document_id,page_number,content,section_title) values(?,?,?,?)
                    """, id, page.number(), page.text(), page.section());
                for (int n = 0; n < chunks.size(); n++) {
                    var chunk = chunks.get(n);
                    db.update("insert into specification_passage(document_id,page_number,offset_chars,content) values(?,?,?,?)",
                        id, chunk.page(), chunk.offset(), chunk.content());
                    if (!index.vectors().isEmpty()) passages.embed(id, chunk, index.vectors().get(n), LocalDocumentModels.EMBEDDING);
                }
                long indexed = db.queryForObject("""
                    select count(*) from specification_passage where document_id=?
                      and (? = false or (embedding is not null and embedding_model=?))
                    """, Long.class, id, !index.vectors().isEmpty(), LocalDocumentModels.EMBEDDING);
                if (indexed != chunks.size()) throw new IllegalStateException("Incomplete document index");
                db.update("update element_specification set index_status=?, index_error=?, index_model=?, ocr_pages=? where id=?",
                    index.vectors().isEmpty() ? "TEXT_ONLY" : "INDEXED", index.reason(),
                    index.vectors().isEmpty() ? null : LocalDocumentModels.EMBEDDING, pages.stream().filter(PdfText.Page::ocr).count(), id);
                return null;
            });
        } catch (Exception ex) {
            if (ex instanceof InterruptedException) Thread.currentThread().interrupt();
            String reason = switch (ex) {
                case PdfText.Rejected rejected -> rejected.getMessage();
                case NoSuchFileException ignored -> "UPLOAD_LOST";
                case IOException ignored -> "INVALID_OR_UNREADABLE_PDF";
                default -> "INDEX_FAILED";
            };
            try { remove(id); } catch (IOException ignored) { reason = "CLEANUP_FAILED"; }
            db.update("update element_specification set index_status='FAILED', index_error=? where id=?", reason, id);
        }
    }

    @Scheduled(scheduler = "documentScheduler", fixedDelay = 600_000, initialDelay = 60_000)
    void cleanSpool() {
        if (!Files.isDirectory(spool)) return;
        try (var files = Files.list(spool)) {
            for (var path : files.toList()) {
                String name = path.getFileName().toString();
                if (Files.getLastModifiedTime(path).toInstant().isAfter(Instant.now().minusSeconds(3600))) continue;
                if (name.startsWith("ocr-") || name.startsWith("upload-")) Files.deleteIfExists(path);
                else if (name.endsWith(".pdf")) {
                    UUID id;
                    try { id = UUID.fromString(name.substring(0, name.length() - 4)); }
                    catch (IllegalArgumentException ignored) { continue; }
                    var state = db.queryForList("select index_status from element_specification where id=?", String.class, id);
                    if (!state.contains("QUEUED") && !state.contains("PROCESSING")) Files.deleteIfExists(path);
                }
            }
        } catch (IOException ex) {
            LoggerFactory.getLogger(getClass()).warn("The temporary document directory could not be cleaned");
        }
    }

    private record VectorIndex(List<float[]> vectors, String reason) {}

    private VectorIndex vectorize(UUID id, List<Passage> chunks) {
        if (!embeddings.enabled()) return new VectorIndex(List.of(), "EMBEDDINGS_DISABLED");
        if (chunks.stream().mapToInt(p -> p.content().getBytes(StandardCharsets.UTF_8).length).sum() > 350_000)
            return new VectorIndex(List.of(), "VECTOR_INPUT_LIMIT");
        UUID run = journal.start(id, 0, LocalDocumentModels.EMBEDDING);
        try {
            var vectors = new ArrayList<float[]>();
            for (int start = 0; start < chunks.size(); start += 8)
                vectors.addAll(embeddings.embedPassages(
                    chunks.subList(start, Math.min(start + 8, chunks.size())).stream().map(Passage::content).toList()));
            journal.finish(run, UNKNOWN);
            return new VectorIndex(vectors, null);
        } catch (ProviderFailure failure) {
            journal.fail(run, failure.code(), UNKNOWN);
            return new VectorIndex(List.of(), failure.code());
        }
    }

    private static List<Passage> split(List<PdfText.Page> pages) {
        var result = new ArrayList<Passage>();
        for (var page : pages) {
            var text = page.text();
            // Offsets count Unicode characters, consistently with PostgreSQL's substr and legacy passage keys.
            var chars = text.codePoints().toArray();
            for (int start = 0; start < chars.length; start += 1200) {
                int length = Math.min(1400, chars.length - start);
                result.add(new Passage(page.number(), start + 1, new String(chars, start, length)));
                if (start + length == chars.length) break;
            }
        }
        return result;
    }
}
