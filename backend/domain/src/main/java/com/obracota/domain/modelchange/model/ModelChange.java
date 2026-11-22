package com.obracota.domain.modelchange.model;

import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.report.Estimate;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.security.model.Actor;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * A change proposed over one base version: its recipe, its verified preview and its life cycle
 * ({@code DRAFT → READY → APPLIED → RESTORED}, plus {@code DISCARDED}). Every transition returns a new value and
 * throws {@link ChangeStateException} when the state does not allow it.
 * <ul>
 *   <li>The recipe only changes in {@code DRAFT}; from {@code READY} on it is frozen.</li>
 *   <li>A change created by the agent never goes past {@code READY}: applying needs the person (checked by the use case).</li>
 *   <li>{@code reportRecipeSha256} is the backend hash of the recipe the report was made for: the report is current
 *       only while it equals the hash of the recipe.</li>
 *   <li>{@code legacyReview} is the door review JSON of the routes before H1; {@code picture} says whether the change
 *       has a visual reference (the bytes live in the repository).</li>
 * </ul>
 */
public record ModelChange(UUID id, UUID project, UUID file, UUID baseVersion, String format, ChangeStatus status,
                          ChangeOrigin origin, UUID author, UUID agentRun, String description, String summary, Recipe recipe,
                          PreviewReport report, String reportRecipeSha256, Instant previewedAt, Preview preview,
                          String legacyReview, boolean picture, Instant submittedAt,
                          Publication applied, Estimate approvedEstimate, Publication restored, Discard discarded,
                          Instant createdAt, Instant updatedAt) {
    public static final int TEXT_LIMIT = 2000;
    private static final Set<String> FORMATS = Set.of("IFC", "DWG");

    /** The verified IFC of the last ok preview, stored by the backend under its own id. */
    public record Preview(UUID id, String sha256, long size) {
        public Preview {
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(sha256, "sha256");
            if (size < 0) throw new IllegalArgumentException("Invalid size");
        }
    }

    /** A published revision: which version, when and who. {@code version} may be gone ({@code on delete set null}). */
    public record Publication(UUID version, Instant at, UUID by) {
        public Publication { Objects.requireNonNull(at, "at"); }
    }

    /** Who discarded or rejected the change, and whether it was the person or the agent. */
    public record Discard(Instant at, UUID by, Actor.Kind kind) {
        public Discard {
            Objects.requireNonNull(at, "at");
            Objects.requireNonNull(kind, "kind");
        }
    }

    public ModelChange {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(project, "project");
        Objects.requireNonNull(file, "file");
        Objects.requireNonNull(baseVersion, "baseVersion");
        if (!FORMATS.contains(format)) throw new IllegalArgumentException("Formato inválido");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(origin, "origin");
        Objects.requireNonNull(author, "author");
        Objects.requireNonNull(recipe, "recipe");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(updatedAt, "updatedAt");
        if (description == null || description.isBlank() || description.length() > TEXT_LIMIT)
            throw new IllegalArgumentException("Descripción inválida");
        if (summary != null && summary.length() > TEXT_LIMIT) throw new IllegalArgumentException("Resumen inválido");
        if ((origin == ChangeOrigin.AGENT) != (agentRun != null)) throw new IllegalArgumentException("Only agent changes carry a run");
        if (report != null && (reportRecipeSha256 == null || previewedAt == null))
            throw new IllegalArgumentException("A report needs the recipe hash and its date");
        if (preview != null && (report == null || !report.ok())) throw new IllegalArgumentException("A preview file needs an ok report");
        if (status.published() && applied == null) throw new IllegalArgumentException("A published change needs its application");
        if (status == ChangeStatus.RESTORED && restored == null) throw new IllegalArgumentException("A restored change needs its restoration");
        if ((status == ChangeStatus.DISCARDED) != (discarded != null)) throw new IllegalArgumentException("Discard data only when discarded");
    }

    /** A new, empty draft over {@code baseVersion}, proposed by {@code actor}. */
    public static ModelChange draft(UUID id, UUID project, UUID file, UUID baseVersion, String format, Actor actor,
                                    String description, Instant now) {
        if (description == null || description.isBlank() || description.strip().length() > TEXT_LIMIT)
            throw new IllegalArgumentException("Descripción inválida");
        return new ModelChange(id, project, file, baseVersion, format, ChangeStatus.DRAFT, ChangeOrigin.of(actor), actor.user(),
            actor.run(), description.strip(), null, Recipe.empty(), null, null, null, null, null, false, null,
            null, null, null, null, now, now);
    }

    /** The door review of the routes before H1 and whether a visual reference is attached (the door facade). */
    public ModelChange annotated(String review, boolean withPicture) {
        var next = new Next(this);
        next.legacyReview = review;
        next.picture = withPicture;
        return next.build();
    }

    /** Whether the stored report belongs to the recipe whose backend hash is {@code recipeSha256}. */
    public boolean reportCurrent(String recipeSha256) {
        return report != null && reportRecipeSha256.equals(recipeSha256);
    }

    /** Whether {@code actor} may edit, preview, submit or discard it: the person always; an agent only its own run's. */
    public boolean touchableBy(Actor actor) {
        return actor.person() || origin == ChangeOrigin.AGENT && agentRun.equals(actor.run()) && project.equals(actor.project());
    }

    /** Edits the recipe. The previous preview stops being current because the recipe hash changes. */
    public ModelChange withRecipe(Recipe next, Instant now) {
        if (status != ChangeStatus.DRAFT) throw new ChangeStateException("Solo se editan las operaciones de un borrador.");
        var copy = new Next(this);
        copy.recipe = Objects.requireNonNull(next, "recipe");
        copy.updatedAt = now;
        return copy.build();
    }

    /**
     * Stores the report of a preview made for the recipe hashed {@code recipeSha256}. {@code file} is the stored
     * verified IFC when {@code report.ok()}, and {@code null} otherwise. A {@code READY} change whose new preview fails
     * goes back to {@code DRAFT}.
     */
    public ModelChange previewed(PreviewReport next, String recipeSha256, Preview file, Instant now) {
        if (!status.pending()) throw new ChangeStateException(closed());
        Objects.requireNonNull(next, "report");
        Objects.requireNonNull(recipeSha256, "recipeSha256");
        if (next.ok() != (file != null)) throw new IllegalArgumentException("An ok preview comes with its file, a failed one without");
        var copy = new Next(this);
        copy.report = next;
        copy.reportRecipeSha256 = recipeSha256;
        copy.previewedAt = now;
        copy.preview = file;
        if (status == ChangeStatus.READY && !next.ok()) {
            copy.status = ChangeStatus.DRAFT;
            copy.submittedAt = null;
        }
        copy.updatedAt = now;
        return copy.build();
    }

    /** Sends the draft for approval. Needs operations and a current, ok and stored preview. */
    public ModelChange submitted(String recipeSha256, String text, Instant now) {
        if (status != ChangeStatus.DRAFT) throw new ChangeStateException("Solo se envía a aprobación un borrador.");
        if (recipe.isEmpty()) throw new ChangeStateException("Añade al menos una operación antes de enviar el cambio.");
        if (!reportCurrent(recipeSha256) || preview == null) throw new ChangeStateException("Previsualiza el cambio para enviarlo.");
        if (!report.ok()) throw new ChangeStateException("La vista previa no superó las comprobaciones.");
        var copy = new Next(this);
        copy.status = ChangeStatus.READY;
        copy.summary = text == null || text.isBlank() ? null : text.strip();
        copy.submittedAt = now;
        copy.updatedAt = now;
        return copy.build();
    }

    /** Discards a draft or rejects a change waiting for approval; its preview file goes away. */
    public ModelChange discarded(Actor actor, Instant now) {
        if (status.published()) throw new ChangeStateException("Un cambio aplicado se revierte con una revisión de restauración.");
        if (status == ChangeStatus.DISCARDED) throw new ChangeStateException("El cambio ya está descartado.");
        var copy = new Next(this);
        copy.status = ChangeStatus.DISCARDED;
        copy.preview = null;
        copy.discarded = new Discard(now, actor.user(), actor.kind());
        copy.updatedAt = now;
        return copy.build();
    }

    /** Publishes the approved preview as {@code version}, freezing the estimate that was approved. */
    public ModelChange applied(UUID version, UUID by, Estimate estimate, String recipeSha256, Instant now) {
        if (status == ChangeStatus.DRAFT) throw new ChangeStateException("Previsualiza el cambio para aprobarlo.");
        if (status != ChangeStatus.READY) throw new ChangeStateException(closed());
        if (!reportCurrent(recipeSha256) || !report.ok() || preview == null)
            throw new ChangeStateException("La vista previa no está vigente; previsualiza el cambio de nuevo.");
        var copy = new Next(this);
        copy.status = ChangeStatus.APPLIED;
        copy.applied = new Publication(Objects.requireNonNull(version, "version"), now, by);
        copy.approvedEstimate = estimate;
        copy.preview = null;
        copy.updatedAt = now;
        return copy.build();
    }

    /** Records the restoration revision that brings back the bytes of the base. */
    public ModelChange restored(UUID version, UUID by, Instant now) {
        if (status == ChangeStatus.RESTORED) throw new ChangeStateException("El cambio ya está restaurado.");
        if (status != ChangeStatus.APPLIED) throw new ChangeStateException("Todavía no se aplicó el cambio.");
        var copy = new Next(this);
        copy.status = ChangeStatus.RESTORED;
        copy.restored = new Publication(Objects.requireNonNull(version, "version"), now, by);
        copy.updatedAt = now;
        return copy.build();
    }

    /** Forgets the preview file (sweeper, or another change of the file was published). The report is kept. */
    public ModelChange previewCleared(Instant now) {
        if (preview == null) return this;
        var copy = new Next(this);
        copy.preview = null;
        copy.updatedAt = now;
        return copy.build();
    }

    private String closed() {
        return switch (status) {
            case APPLIED -> "El cambio ya se aplicó.";
            case RESTORED -> "El cambio ya está restaurado.";
            case DISCARDED -> "El cambio está descartado.";
            default -> "El cambio no admite esta acción.";
        };
    }

    /** Mutable copy used by the transitions; {@link #build()} validates the result through the canonical constructor. */
    private static final class Next {
        private final UUID id, project, file, baseVersion, author, agentRun;
        private final String format, description;
        private final ChangeOrigin origin;
        private final Instant createdAt;
        private ChangeStatus status;
        private String summary, reportRecipeSha256, legacyReview;
        private Recipe recipe;
        private PreviewReport report;
        private Instant previewedAt, submittedAt, updatedAt;
        private Preview preview;
        private boolean picture;
        private Publication applied, restored;
        private Estimate approvedEstimate;
        private Discard discarded;

        private Next(ModelChange c) {
            id = c.id; project = c.project; file = c.file; baseVersion = c.baseVersion; format = c.format; status = c.status;
            origin = c.origin; author = c.author; agentRun = c.agentRun; description = c.description; summary = c.summary;
            recipe = c.recipe; report = c.report; reportRecipeSha256 = c.reportRecipeSha256; previewedAt = c.previewedAt;
            preview = c.preview; legacyReview = c.legacyReview; picture = c.picture; submittedAt = c.submittedAt;
            applied = c.applied; approvedEstimate = c.approvedEstimate; restored = c.restored; discarded = c.discarded;
            createdAt = c.createdAt; updatedAt = c.updatedAt;
        }

        private ModelChange build() {
            return new ModelChange(id, project, file, baseVersion, format, status, origin, author, agentRun, description, summary,
                recipe, report, reportRecipeSha256, previewedAt, preview, legacyReview, picture, submittedAt, applied,
                approvedEstimate, restored, discarded, createdAt, updatedAt);
        }
    }
}
