package com.obracota.infrastructure.modelchange.adapters.out.storage;

import com.obracota.application.common.port.Transactions;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.ModelChangeEvent;
import com.obracota.domain.modelchange.port.ModelChangeRepository;
import com.obracota.domain.modelversion.port.VersionRepository;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Hourly cleanup of the preview volume (§4.5, R10, J18):
 * <ul>
 *   <li>files older than {@link #ORPHAN_AGE} that no {@code DRAFT} or {@code READY} row references, and {@code .part}
 *       files older than that (a write cut halfway);</li>
 *   <li>the preview of every {@code DRAFT} without activity for {@link #IDLE_DRAFT}, and of every pending change whose
 *       base is no longer the latest revision: the file goes, {@code preview_*} becomes null with a {@code SYSTEM}
 *       event, and the report is kept. A {@code READY} change on the latest base keeps its preview.</li>
 * </ul>
 * Files younger than an hour are never touched, so a preview being written or about to be committed is safe.
 */
public class PreviewSweeper {
    static final Duration ORPHAN_AGE = Duration.ofHours(1);
    static final Duration IDLE_DRAFT = Duration.ofHours(24);
    static final String IDLE = "Vista previa borrada tras 24 h sin actividad; previsualízalo de nuevo para enviarlo.";
    static final String STALE = "Vista previa borrada: la base dejó de ser la última revisión.";
    private static final Logger log = LoggerFactory.getLogger(PreviewSweeper.class);

    /** What one sweep did, for the logs and the tests. */
    public record Result(int orphans, int parts, int cleared) {}

    private final PreviewVolumeStorage storage;
    private final ModelChangeRepository changes;
    private final VersionRepository versions;
    private final Transactions tx;
    private final Clock clock;

    public PreviewSweeper(PreviewVolumeStorage storage, ModelChangeRepository changes, VersionRepository versions, Transactions tx, Clock clock) {
        this.storage = storage;
        this.changes = changes;
        this.versions = versions;
        this.tx = tx;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${previews.sweep-interval-ms:3600000}", initialDelayString = "${previews.sweep-initial-delay-ms:3600000}")
    public void scheduled() {
        try {
            var result = sweep();
            if (result.orphans() + result.parts() + result.cleared() > 0) log.info("Preview sweep: {}", result);
        } catch (RuntimeException e) {
            log.warn("Preview sweep failed", e);
        }
    }

    public Result sweep() {
        var now = clock.instant();
        int cleared = 0;
        for (var holding : changes.holdingPreviews()) {
            var reason = reason(holding, now);
            if (reason == null) continue;
            if (clear(holding, reason)) cleared++;
        }
        var referenced = new HashSet<String>();
        for (var holding : changes.holdingPreviews())
            referenced.add(key(holding.project(), holding.id(), holding.preview().id()));
        var cutoff = now.minus(ORPHAN_AGE);
        int orphans = 0, parts = 0;
        for (var entry : storage.files()) {
            if (!entry.modified().toInstant().isBefore(cutoff)) continue;
            if (entry.partial()) {
                storage.remove(entry);
                parts++;
                continue;
            }
            var preview = entry.previewId();
            if (preview.isPresent() && referenced.contains(key(entry.project(), entry.change(), preview.get()))) continue;
            storage.remove(entry);
            orphans++;
        }
        return new Result(orphans, parts, cleared);
    }

    private String reason(ModelChange change, java.time.Instant now) {
        var history = versions.history(change.file());
        if (history.isEmpty() || !history.getFirst().id().equals(change.baseVersion())) return STALE;
        if (change.status() == ChangeStatus.DRAFT && change.updatedAt().isBefore(now.minus(IDLE_DRAFT))) return IDLE;
        return null;
    }

    /**
     * Clears the row first (only if it still points to the same file), then removes the file. The row is read under the
     * project lock that preview, submit, discard, apply and the edits take before they read: without it, a preview or a
     * submit committed between this read and the update below would be overwritten by the stale copy (lost report and
     * {@code preview_id}, a {@code READY} back to {@code DRAFT}). With it, they wait, and then find no preview.
     */
    private boolean clear(ModelChange seen, String reason) {
        var file = seen.preview();
        boolean done = tx.required(() -> {
            var current = changes.findLockingProject(seen.project(), seen.id()).orElse(null);
            if (current == null || !current.status().pending() || current.preview() == null || !current.preview().id().equals(file.id()))
                return false;
            var now = clock.instant();
            changes.update(current.previewCleared(now));
            changes.record(ModelChangeEvent.system(current.id(), ModelChangeEvent.Action.PREVIEW_CLEARED, reason, now));
            return true;
        });
        if (done) storage.delete(seen.project(), seen.id(), file.id());
        return done;
    }

    private static String key(UUID project, UUID change, UUID preview) { return project + "/" + change + "/" + preview; }
}
