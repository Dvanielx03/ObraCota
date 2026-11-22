package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.*;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelchange.rules.ChangeFindings;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.rulefinding.DoorRules;
import com.obracota.domain.designchange.BimEditPort;
import com.obracota.domain.modelchange.model.ChangeStateException;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.ModelChangeEvent;
import com.obracota.domain.modelchange.model.ModelChangeEvent.Action;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.modelchange.model.recipe.GlobalId;
import com.obracota.domain.modelchange.model.recipe.Operation;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.recipe.SetProperty;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.port.*;
import com.obracota.domain.modelchange.port.ModelEnginePort.VersionRef;
import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.security.model.Actor;
import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.function.Function;

/**
 * Drafting a model change: create, read, edit operations, preview, submit and discard, plus the door facade.
 * It never publishes: that is {@link PublishModelChange}, which the agent's catalog never receives.
 * <p>
 * It is a {@code final} class with private fields, not a record, on purpose: a record would publish its components and
 * the agent could reach {@code ProjectVersions.upload} through it (J14). No public method returns what publishes.
 * <p>
 * The engine is never called inside a transaction, so the project lock never waits for it (§4.5).
 */
public final class ModelChanges {
    /** Operations the backend lets through (§5.4): the door of equal size and, since step 11 of H1 (H2.1), typed properties. */
    public static final Set<String> ENABLED_OPERATIONS = Set.of(ChangeType.OP, SetProperty.OP);
    public static final int LIST_LIMIT = 100;
    public static final int REASON_LIMIT = 500;
    static final String PREVIEW_MISSING = "La vista previa no está disponible.";
    static final String PREVIEW_LOST = "El motor no conservó la vista previa; vuelve a intentarlo.";
    static final String ENGINE_LATE = "El motor IFC no respondió a tiempo; vuelve a intentarlo.";
    /**
     * Budget of one request that previews (§4.5, R1), from the moment it enters: every engine call of the request gets
     * what is left. It stays under the 240 s of the Next.js proxy, so the browser never sees the proxy cut while the
     * backend keeps working and later stores a preview the card reported as failed.
     */
    public static final Duration REQUEST_BUDGET = Duration.ofSeconds(200);

    private final ProjectVersions versions;
    private final ModelChangeRepository changes;
    private final PriceBook prices;
    private final PreviewStorage previews;
    private final ModelEnginePort engine;
    private final BimEditPort doors;
    private final Transactions tx;
    private final Clock clock;
    private final ChangeViews views;
    private final Duration budget;

    public ModelChanges(ProjectVersions versions, ModelChangeRepository changes, PriceBook prices, PreviewStorage previews,
                        ModelEnginePort engine, BimEditPort doors, RecipeCodec codec, Transactions tx, Clock clock) {
        this(versions, changes, prices, previews, engine, doors, codec, tx, clock, REQUEST_BUDGET);
    }

    public ModelChanges(ProjectVersions versions, ModelChangeRepository changes, PriceBook prices, PreviewStorage previews,
                        ModelEnginePort engine, BimEditPort doors, RecipeCodec codec, Transactions tx, Clock clock, Duration budget) {
        if (budget == null || budget.isNegative() || budget.isZero()) throw new IllegalArgumentException("budget must be positive");
        this.budget = budget;
        this.versions = versions;
        this.changes = changes;
        this.prices = prices;
        this.previews = previews;
        this.engine = engine;
        this.doors = doors;
        this.tx = tx;
        this.clock = clock;
        this.views = new ChangeViews(versions, changes, prices, previews, codec);
    }

    /** Bytes of the stored preview, its size and the name to save it with ({@code <base>-propuesta.ifc}). The caller closes it. */
    public record PreviewFile(InputStream content, long size, String fileName) {}

    private record Snapshot(ModelChange change, ModelVersion base, String hash) {}

    private record Verified(PreviewReport report, PreviewStorage.Stored stored) {}

    /** The end of a request's budget, on the monotonic clock (the injected {@link Clock} may be fixed in tests). */
    private static final class Deadline {
        private final long end;

        Deadline(Duration budget) { end = System.nanoTime() + budget.toNanos(); }

        Duration left() { return Duration.ofNanos(Math.max(0, end - System.nanoTime())); }

        boolean passed() { return end - System.nanoTime() <= 0; }

        /** What is left, or a 503 when nothing is: the engine is never called with an empty budget. */
        Duration require() {
            var left = left();
            if (left.isZero()) throw new EngineUnavailableException(null, ENGINE_LATE);
            return left;
        }
    }

    // Reading -------------------------------------------------------------------------------------------------------

    /** Changes of the project, most recent first, at most {@value #LIST_LIMIT}. Empty {@code statuses}: every status. */
    public List<ChangeView> list(Actor actor, UUID project, Set<ChangeStatus> statuses, UUID file) {
        Guards.reach(actor, project);
        versions.catalog().requireOwner(project, actor.user());
        if (file != null) versions.list(project, actor.user(), file);
        return views.many(actor, changes.list(project, statuses == null ? Set.of() : Set.copyOf(statuses), file, LIST_LIMIT));
    }

    public ChangeView get(Actor actor, UUID project, UUID id) {
        Guards.reach(actor, project);
        return views.one(actor, owned(actor, project, id));
    }

    public PreviewFile previewFile(Actor actor, UUID project, UUID id) {
        Guards.reach(actor, project);
        var change = owned(actor, project, id);
        var preview = change.preview();
        if (preview == null) throw new NotFoundApplicationException(PREVIEW_MISSING);
        var base = versions.get(project, actor.user(), change.baseVersion());
        try {
            return new PreviewFile(previews.read(project, id, preview.id()), preview.size(), proposalName(base.name()));
        } catch (IOException e) {
            throw new NotFoundApplicationException(PREVIEW_MISSING);
        }
    }

    public byte[] picture(Actor actor, UUID project, UUID id) {
        Guards.reach(actor, project);
        versions.catalog().requireOwner(project, actor.user());
        return changes.picture(project, id).orElseThrow(NotFoundApplicationException::new);
    }

    // Drafting ------------------------------------------------------------------------------------------------------

    /** A new empty draft over the latest revision of an IFC file. */
    public ChangeView create(Actor actor, UUID project, UUID baseVersion, String description) {
        Guards.reach(actor, project);
        var id = tx.required(() -> insertDraft(actor, project, baseVersion, description, null, null, null));
        return get(actor, project, id);
    }

    /** Appends an operation after the engine accepts it in {@code checks_only}; the server assigns {@code op-<max+1>}. */
    public ChangeView addOperation(Actor actor, UUID project, UUID id, Operation operation) {
        return gatedEdit(actor, project, id, operation, null);
    }

    /** Replaces operation {@code operationId}, keeping its id and its place. */
    public ChangeView replaceOperation(Actor actor, UUID project, UUID id, String operationId, Operation operation) {
        if (operationId == null) throw new NotFoundApplicationException("La operación no existe.");
        return gatedEdit(actor, project, id, operation, operationId);
    }

    public ChangeView removeOperation(Actor actor, UUID project, UUID id, String operationId) {
        Guards.reach(actor, project);
        tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var start = editable(actor, project, id);
            var recipe = start.change().recipe();
            if (operationId == null || recipe.find(operationId).isEmpty()) throw new NotFoundApplicationException("La operación no existe.");
            changes.update(start.change().withRecipe(recipe.remove(operationId), now()));
            changes.record(event(id, Action.EDIT, actor, "Quitada " + operationId + "."));
            return null;
        });
        return get(actor, project, id);
    }

    /**
     * Previews the recipe on the base (§4.5): a short read, the engine and the stored verified IFC outside any
     * transaction, then a short locked write that only lands if the recipe, the state and the base did not move.
     * {@code ok=false} is an answer, not an error: the change keeps (or goes back to) {@code DRAFT} with its report.
     */
    public ChangeView preview(Actor actor, UUID project, UUID id) {
        return preview(actor, project, id, new Deadline(budget));
    }

    private ChangeView preview(Actor actor, UUID project, UUID id, Deadline deadline) {
        Guards.reach(actor, project);
        var start = tx.required(() -> previewable(actor, project, id));
        var recipe = start.change().recipe();
        var verified = verify(project, id, VersionRef.of(project, start.base()), recipe, deadline);
        var stored = verified.stored();
        try {
            var report = ChangeFindings.withDoorRules(recipe, verified.report(), prices.minimumWidth(project).orElse(null));
            var previous = tx.required(() -> {
                versions.catalog().requireOwnerForUpdate(project, actor.user());
                var current = Guards.load(changes, project, id);
                if (!current.status().pending()) throw new ChangeStateException("Un cambio aplicado, restaurado o descartado ya no se previsualiza.");
                if (current.status() != start.change().status() || !views.hash(current.recipe()).equals(start.hash()))
                    throw new ConflictApplicationException("La receta cambió durante la vista previa; previsualiza el cambio de nuevo.");
                Guards.requireLatest(versions, actor, project, start.base(), Guards.STALE);
                var file = stored == null ? null : new ModelChange.Preview(stored.id(), stored.sha256(), stored.size());
                var next = current.previewed(report, start.hash(), file, now());
                changes.update(next);
                changes.record(event(id, Action.PREVIEW, actor, previewDetail(current, next)));
                return current.preview();
            });
            if (previous != null && (stored == null || !previous.id().equals(stored.id())))
                Guards.quietly(() -> previews.delete(project, id, previous.id()));
        } catch (RuntimeException e) {
            if (stored != null) Guards.quietly(() -> previews.delete(project, id, stored.id()));
            throw e;
        }
        return get(actor, project, id);
    }

    /** {@code DRAFT → READY}: needs operations and a current, ok and available preview, on the latest base. */
    public ChangeView submit(Actor actor, UUID project, UUID id, String summary) {
        Guards.reach(actor, project);
        if (summary != null && summary.strip().length() > ModelChange.TEXT_LIMIT) throw new IllegalArgumentException("Resumen inválido");
        tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var change = Guards.load(changes, project, id);
            Guards.touch(actor, change);
            if (change.status() != ChangeStatus.DRAFT)
                throw new ChangeStateException(change.status() == ChangeStatus.READY ? "El cambio ya está listo para aprobar." : "Solo se envía a aprobación un borrador.");
            var base = versions.get(project, actor.user(), change.baseVersion());
            Guards.requireLatest(versions, actor, project, base, Guards.STALE);
            if (change.recipe().isEmpty())
                throw new UnprocessableApplicationException("RECIPE_EMPTY", "Añade al menos una operación antes de enviar el cambio.");
            var hash = views.hash(change.recipe());
            if (!change.reportCurrent(hash)) throw new ConflictApplicationException("Previsualiza el cambio para enviarlo.");
            if (!change.report().ok()) throw new UnprocessableApplicationException("PREVIEW_FAILED", "La vista previa no superó las comprobaciones.");
            if (change.preview() == null || !previews.exists(project, id, change.preview().id()))
                throw new ConflictApplicationException("La vista previa ya no está disponible; previsualiza el cambio de nuevo.");
            changes.update(change.submitted(hash, summary, now()));
            changes.record(event(id, Action.SUBMIT, actor, null));
            return null;
        });
        return get(actor, project, id);
    }

    /** Discards a draft or rejects a change waiting for approval. Allowed on a stale base too. */
    public ChangeView discard(Actor actor, UUID project, UUID id, String reason) {
        Guards.reach(actor, project);
        if (reason != null && reason.length() > REASON_LIMIT) throw new IllegalArgumentException("Motivo inválido");
        tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var change = Guards.load(changes, project, id);
            Guards.touch(actor, change);
            changes.update(change.discarded(actor, now()));
            changes.record(event(id, Action.DISCARD, actor, reason == null || reason.isBlank() ? null : reason.strip()));
            return null;
        });
        Guards.quietly(() -> previews.deleteAll(project, id));
        return get(actor, project, id);
    }

    // Door facade (/design-changes) ---------------------------------------------------------------------------------

    /** {@code /inspect} of a door, as {@code GET /design-changes/door} returns it today. */
    public BimEditPort.Door door(Actor actor, UUID project, UUID version, String element) throws IOException {
        Guards.reach(actor, project);
        Guards.ifc(versions, actor, project, version);
        return doors.inspect(project, version, GlobalId.require(element));
    }

    /** Today's door review: {@code /inspect}, {@code DoorRules} and the type prices of the version. */
    public DoorReview doorReview(Actor actor, UUID project, UUID version, String element, String typeId) throws IOException {
        var door = door(actor, project, version, element);
        GlobalId.require(typeId);
        var type = door.options().stream().filter(option -> option.id().equals(typeId)).findFirst()
            .orElseThrow(() -> new UnprocessableApplicationException("TYPE_NOT_AVAILABLE", "El tipo no está disponible en este IFC."));
        var book = prices.prices(project, version);
        var before = doorPrice(book, door.typeId());
        var after = doorPrice(book, typeId);
        var estimate = new DoorReview.Estimate(1, 1, before, after,
            before == null || after == null ? null : after.amount().subtract(before.amount()));
        return new DoorReview(door, type, DoorRules.evaluate(door, type, prices.minimumWidth(project).orElse(null)), estimate);
    }

    /**
     * {@code POST /design-changes}: computes today's review (422 when the type is not among the options), creates the
     * draft with its {@code ifc.change_type} without the {@code checks_only} gate, so an incompatible type can still be
     * recorded for review, and previews it. With {@code ok} it goes to {@code READY}; otherwise it stays in
     * {@code DRAFT} with its report. {@code legacyJson} writes the review the way {@code legacy_review} stores it.
     * If the engine fails during the preview the exception reaches the caller and the draft is kept.
     */
    public ChangeView proposeDoor(Actor actor, UUID project, UUID version, String element, String typeId, String description,
                                  byte[] picture, Function<DoorReview, String> legacyJson) throws IOException {
        var deadline = new Deadline(budget);
        Guards.reach(actor, project);
        if (description == null || description.isBlank() || description.length() > ModelChange.TEXT_LIMIT)
            throw new IllegalArgumentException("Descripción inválida");
        var review = doorReview(actor, project, version, element, typeId);
        var legacy = legacyJson.apply(review);
        var id = tx.required(() -> insertDraft(actor, project, version, description, new ChangeType(null, element, typeId), legacy, picture));
        var view = preview(actor, project, id, deadline);
        var report = view.change().report();
        return report != null && report.ok() ? submit(actor, project, id, null) : view;
    }

    /** What {@code GET /design-changes} lists: the changes that carry a door review, most recent first. */
    public List<ChangeView> doorChanges(Actor actor, UUID project) {
        Guards.reach(actor, project);
        versions.catalog().requireOwner(project, actor.user());
        var list = changes.list(project, Set.of(), null, Integer.MAX_VALUE).stream()
            .filter(change -> change.legacyReview() != null).toList();
        return views.many(actor, list);
    }

    // Internals -----------------------------------------------------------------------------------------------------

    private ChangeView gatedEdit(Actor actor, UUID project, UUID id, Operation operation, String replacing) {
        Guards.reach(actor, project);
        if (operation == null) throw new InvalidRequestApplicationException("RECIPE_INVALID", "Falta la operación.");
        if (!ENABLED_OPERATIONS.contains(operation.op()))
            throw new UnprocessableApplicationException("OPERATION_NOT_ENABLED", "La operación " + operation.op() + " no está habilitada.");
        var start = tx.required(() -> editable(actor, project, id));
        var recipe = start.change().recipe();
        if (replacing != null && recipe.find(replacing).isEmpty()) throw new NotFoundApplicationException("La operación no existe.");
        var next = edited(recipe, operation, replacing);
        var assigned = replacing == null ? next.operations().getLast().id() : replacing;
        gate(VersionRef.of(project, start.base()), next, assigned);
        tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var current = Guards.load(changes, project, id);
            if (current.status() != ChangeStatus.DRAFT || !views.hash(current.recipe()).equals(start.hash())
                || !Guards.latest(versions, actor, project, start.base().fileId()).id().equals(start.base().id()))
                throw new ConflictApplicationException(Guards.MODIFIED);
            changes.update(current.withRecipe(next, now()));
            changes.record(event(id, Action.EDIT, actor, (replacing == null ? "Añadida " : "Cambiada ") + assigned + " (" + operation.op() + ")."));
            return null;
        });
        return get(actor, project, id);
    }

    private static Recipe edited(Recipe recipe, Operation operation, String replacing) {
        var conflict = recipe.conflict(operation, replacing);
        if (conflict.isPresent())
            throw new InvalidRequestApplicationException("DUPLICATE_TARGET", "La operación " + conflict.get().id() + " ya cambia lo mismo.");
        try {
            return replacing == null ? recipe.append(operation) : recipe.replace(replacing, operation);
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestApplicationException("RECIPE_INVALID", e.getMessage() + ".");
        }
    }

    /** The engine runs the checks of the whole new recipe; the first error, preferably the edited operation's, is a 422. */
    private void gate(VersionRef base, Recipe recipe, String operationId) {
        var checks = engine.check(base, recipe);
        if (checks.ok()) return;
        var error = checks.operations().stream().filter(result -> !result.ok())
            .sorted(Comparator.comparing(result -> !Objects.equals(result.id(), operationId)))
            .flatMap(result -> result.errors().stream()).findFirst();
        throw new UnprocessableApplicationException(
            error.map(PreviewReport.OperationError::code).filter(code -> !code.isBlank()).orElse("OPERATION_REJECTED"),
            error.map(PreviewReport.OperationError::detail).filter(detail -> !detail.isBlank()).orElse("El motor IFC rechazó la operación."));
    }

    private Snapshot editable(Actor actor, UUID project, UUID id) {
        var change = owned(actor, project, id);
        Guards.touch(actor, change);
        if (change.status() != ChangeStatus.DRAFT) throw new ChangeStateException("Solo se editan las operaciones de un borrador.");
        var base = versions.get(project, actor.user(), change.baseVersion());
        Guards.requireLatest(versions, actor, project, base, Guards.STALE);
        return new Snapshot(change, base, views.hash(change.recipe()));
    }

    private Snapshot previewable(Actor actor, UUID project, UUID id) {
        var change = owned(actor, project, id);
        Guards.touch(actor, change);
        if (!change.status().pending()) throw new ChangeStateException("Un cambio aplicado, restaurado o descartado ya no se previsualiza.");
        var base = versions.get(project, actor.user(), change.baseVersion());
        Guards.requireLatest(versions, actor, project, base, Guards.STALE);
        return new Snapshot(change, base, views.hash(change.recipe()));
    }

    /**
     * {@code /preview}, then {@code /build} into a new preview file, each with what is left of the request's budget. If
     * the stored bytes are not the ones the report verified (the engine lost the artifact and rebuilt it), it tries once
     * more, but only when what is left still fits another attempt as long as the first one; otherwise, and after the
     * second attempt, it gives up with a 503 instead of outliving the proxy.
     */
    private Verified verify(UUID project, UUID change, VersionRef base, Recipe recipe, Deadline deadline) {
        for (int attempt = 1; ; attempt++) {
            long started = System.nanoTime();
            var report = engine.preview(base, recipe, deadline.require());
            if (!report.ok()) return new Verified(report, null);
            var stored = store(project, change, base, recipe, report.artifact().id(), deadline);
            if (stored.sha256().equalsIgnoreCase(report.artifact().sha256())) return new Verified(report, stored);
            Guards.quietly(() -> previews.delete(project, change, stored.id()));
            var took = Duration.ofNanos(System.nanoTime() - started);
            if (attempt == 2 || deadline.left().compareTo(took) < 0) throw new EngineUnavailableException("PREVIEW_LOST", PREVIEW_LOST);
        }
    }

    private PreviewStorage.Stored store(UUID project, UUID change, VersionRef base, Recipe recipe, String artifact, Deadline deadline) {
        var build = engine.build(base, recipe, artifact, deadline.require());
        try {
            return previews.write(project, change, UUID.randomUUID(), build.content());
        } catch (IOException e) {
            var detail = deadline.passed() ? ENGINE_LATE : "La vista previa se interrumpió; vuelve a intentarlo.";
            throw new EngineUnavailableException(null, detail, e);
        } finally {
            Guards.close(build);
        }
    }

    private UUID insertDraft(Actor actor, UUID project, UUID baseVersion, String description, Operation first, String legacyReview,
                             byte[] picture) {
        var base = Guards.ifc(versions, actor, project, baseVersion);
        Guards.requireLatest(versions, actor, project, base, Guards.STALE);
        var now = now();
        var change = ModelChange.draft(UUID.randomUUID(), project, base.fileId(), base.id(), base.format(), actor, description, now);
        if (legacyReview != null || picture != null) change = change.annotated(legacyReview, picture != null);
        if (first != null) change = change.withRecipe(change.recipe().append(first), now);
        changes.insert(change, picture);
        changes.record(event(change.id(), Action.CREATE, actor, null));
        if (first != null)
            changes.record(event(change.id(), Action.EDIT, actor, "Añadida op-1 (" + first.op() + ") desde la propuesta de puerta."));
        return change.id();
    }

    private ModelChange owned(Actor actor, UUID project, UUID id) {
        versions.catalog().requireOwner(project, actor.user());
        return Guards.load(changes, project, id);
    }

    private static String previewDetail(ModelChange before, ModelChange after) {
        if (after.report().ok()) return "Vista previa verificada.";
        return before.status() == ChangeStatus.READY ? "La vista previa no superó las comprobaciones; el cambio vuelve a borrador."
            : "La vista previa no superó las comprobaciones.";
    }

    private static DoorReview.Price doorPrice(List<UnitPrice> book, String typeId) {
        if (typeId == null) return null;
        return book.stream().filter(price -> price.key().typeId().filter(typeId::equals).isPresent()).findFirst()
            .map(price -> new DoorReview.Price(typeId, price.amount(), price.source(), price.date())).orElse(null);
    }

    private static String proposalName(String base) {
        var stem = base.toLowerCase(Locale.ROOT).endsWith(".ifc") ? base.substring(0, base.length() - 4) : base;
        return stem + "-propuesta.ifc";
    }

    private ModelChangeEvent event(UUID change, Action action, Actor actor, String detail) {
        return ModelChangeEvent.of(change, action, actor, detail, now());
    }

    private Instant now() { return clock.instant(); }
}
