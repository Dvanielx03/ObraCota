package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.ConflictApplicationException;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelchange.rules.ChangeEstimate;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.ModelChangeEvent;
import com.obracota.domain.modelchange.model.ModelChangeEvent.Action;
import com.obracota.domain.modelchange.port.*;
import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.security.model.Actor;
import java.io.IOException;
import java.time.Clock;
import java.util.*;

/**
 * Publishing a change: apply and restore. Only the person, whatever route or caller: the first line rejects any other
 * actor, which is what protects architecture A, where the agent runs in process without HTTP.
 * <p>
 * Neither calls the engine. Applying uploads exactly the bytes of the approved preview and checks their SHA-256;
 * restoring uploads the bytes of the base. Both copy the prices with their source and date. Each runs in one
 * transaction under the project lock, as the door routes did.
 */
public final class PublishModelChange {
    private final ProjectVersions versions;
    private final ModelChangeRepository changes;
    private final PriceBook prices;
    private final PreviewStorage previews;
    private final Transactions tx;
    private final Clock clock;
    private final ChangeViews views;

    public PublishModelChange(ProjectVersions versions, ModelChangeRepository changes, PriceBook prices, PreviewStorage previews,
                              RecipeCodec codec, Transactions tx, Clock clock) {
        this.versions = versions;
        this.changes = changes;
        this.prices = prices;
        this.previews = previews;
        this.tx = tx;
        this.clock = clock;
        this.views = new ChangeViews(versions, changes, prices, previews, codec);
    }

    /**
     * {@code READY → APPLIED}: revision n+1 of the same file with the preview's bytes. Idempotent on an applied or restored
     * change. The other drafts of the file lose their preview, because their base stopped being the latest.
     */
    public ChangeView apply(Actor actor, UUID project, UUID id) throws IOException {
        Guards.person(actor);
        var cleared = tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var change = Guards.load(changes, project, id);
            if (change.status().published()) return List.<UUID>of();
            if (change.status() == ChangeStatus.DRAFT) throw new ConflictApplicationException("Previsualiza el cambio para aprobarlo.");
            if (change.status() != ChangeStatus.READY) throw new ConflictApplicationException("El cambio está descartado.");
            var base = versions.get(project, actor.user(), change.baseVersion());
            Guards.requireLatest(versions, actor, project, base, Guards.STALE_PUBLISH);
            var hash = views.hash(change.recipe());
            var preview = change.preview();
            if (!change.reportCurrent(hash) || !change.report().ok() || preview == null || !previews.exists(project, id, preview.id()))
                throw new ConflictApplicationException("La vista previa no está vigente; previsualiza el cambio de nuevo.");
            ModelVersion revision;
            try (var bytes = previews.read(project, id, preview.id())) {
                revision = versions.upload(project, actor.user(), base.fileId(), base.name(), preview.size(), bytes);
            }
            if (!revision.sha256().equalsIgnoreCase(preview.sha256()))
                throw new ConflictApplicationException("La revisión no coincide con la vista previa aprobada; previsualiza el cambio de nuevo.");
            var now = clock.instant();
            var estimate = ChangeEstimate.of(change.recipe(), change.report(), prices.prices(project, base.id()));
            prices.copyMissing(project, base.id(), revision.id());
            changes.update(change.applied(revision.id(), actor.user(), estimate, hash, now));
            changes.record(ModelChangeEvent.of(id, Action.APPLY, actor,
                "Revisión v" + revision.revision() + " publicada con la vista previa aprobada.", now));
            List<UUID> done = new ArrayList<>();
            done.add(id);
            for (var sibling : changes.pending(project, base.fileId())) {
                if (sibling.id().equals(id) || sibling.preview() == null) continue;
                changes.update(sibling.previewCleared(now));
                changes.record(ModelChangeEvent.system(sibling.id(), Action.PREVIEW_CLEARED, "La base dejó de ser la última revisión.", now));
                done.add(sibling.id());
            }
            return done;
        });
        for (var change : cleared) Guards.quietly(() -> previews.deleteAll(project, change));
        return view(actor, project, id);
    }

    /** {@code APPLIED → RESTORED}: revision n+2 with the bytes of the base, while the applied revision is still the latest. */
    public ChangeView restore(Actor actor, UUID project, UUID id) throws IOException {
        Guards.person(actor);
        tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var change = Guards.load(changes, project, id);
            if (change.status() == ChangeStatus.RESTORED) return null;
            if (change.status() != ChangeStatus.APPLIED) throw new ConflictApplicationException("Todavía no se aplicó el cambio.");
            var appliedId = change.applied().version();
            if (appliedId == null) throw new ConflictApplicationException("La versión aplicada ya no existe.");
            var applied = versions.get(project, actor.user(), appliedId);
            Guards.requireLatest(versions, actor, project, applied, Guards.STALE_PUBLISH);
            var base = versions.get(project, actor.user(), change.baseVersion());
            ModelVersion revision;
            try (var original = versions.storage().read(project, base.id())) {
                revision = versions.upload(project, actor.user(), base.fileId(), base.name(), base.byteSize(), original);
            }
            if (!revision.sha256().equalsIgnoreCase(base.sha256()))
                throw new ConflictApplicationException("La revisión de restauración no coincide con la base.");
            var now = clock.instant();
            prices.copyMissing(project, applied.id(), revision.id());
            changes.update(change.restored(revision.id(), actor.user(), now));
            changes.record(ModelChangeEvent.of(id, Action.RESTORE, actor,
                "Revisión v" + revision.revision() + " con los bytes de la base v" + base.revision() + ".", now));
            return null;
        });
        return view(actor, project, id);
    }

    private ChangeView view(Actor actor, UUID project, UUID id) {
        versions.catalog().requireOwner(project, actor.user());
        return views.one(actor, Guards.load(changes, project, id));
    }
}
