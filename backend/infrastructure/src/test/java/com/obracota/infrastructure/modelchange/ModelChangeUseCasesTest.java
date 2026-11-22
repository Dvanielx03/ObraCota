package com.obracota.infrastructure.modelchange;

import com.obracota.application.common.exception.*;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelchange.usecase.*;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.designchange.BimEditPort;
import com.obracota.domain.modelchange.model.ChangeOrigin;
import com.obracota.domain.modelchange.model.ChangeStateException;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.ModelChangeEvent;
import com.obracota.domain.modelchange.model.ModelChangeEvent.Action;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.*;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.port.*;
import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.domain.modelfile.port.repository.ModelFileRepository;
import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.modelversion.port.OriginalStorage;
import com.obracota.domain.modelversion.port.VersionRepository;
import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import static org.junit.jupiter.api.Assertions.*;

/**
 * The model change use cases over in-memory ports, without Spring: the sequences of §4.5 (gate, preview with its
 * retry, optimistic checks), the publishing barrier in the use case, prices copied on publish and stale bases.
 * The Spring flow (J1–J17) comes with the adapters and the controllers.
 */
class ModelChangeUseCasesTest {
    static final String DOOR = "1hOSvn6df7F8_7GcBWlS8Z";
    static final String PROPOSED = "2klOFZffH6WQFlV10uM1wF";
    static final String CURRENT = "0000000000000000000001";
    static final String OTHER_DOOR = "0000000000000000000002";
    static final byte[] BASE = "ISO-10303-21;\n/* base */".getBytes(StandardCharsets.UTF_8);

    final UUID owner = UUID.randomUUID();
    final UUID project = UUID.randomUUID();
    final Actor person = Actor.person(owner);
    final Fakes fakes = new Fakes();
    ProjectVersions versions;
    ModelChanges drafts;
    PublishModelChange publish;
    VersionPrices pricing;
    ModelVersion base;

    @BeforeEach void setUp() throws IOException {
        var catalog = new ProjectFileCatalog(fakes.projects, fakes.files);
        versions = new ProjectVersions(catalog, fakes.versions, fakes.originals, fakes.users);
        Transactions tx = new Transactions() {
            public <T, E extends Exception> T required(Work<T, E> work) throws E { return work.run(); }
        };
        var clock = Clock.systemUTC();
        drafts = new ModelChanges(versions, fakes.changes, fakes.prices, fakes.previews, fakes.engine, fakes.doors, fakes.codec, tx, clock);
        publish = new PublishModelChange(versions, fakes.changes, fakes.prices, fakes.previews, fakes.codec, tx, clock);
        pricing = new VersionPrices(versions, fakes.prices, tx);
        base = versions.upload(project, owner, null, "Duplex_A.ifc", BASE.length, new ByteArrayInputStream(BASE));
    }

    ChangeView readyChange(Actor actor) {
        var change = drafts.create(actor, project, base.id(), "Probar una puerta alternativa");
        drafts.addOperation(actor, project, change.change().id(), new ChangeType(null, DOOR, PROPOSED));
        drafts.preview(actor, project, change.change().id());
        return drafts.submit(actor, project, change.change().id(), null);
    }

    List<Action> actions(UUID change) {
        return fakes.changes.events(change).stream().map(ModelChangeEvent::action).toList();
    }

    @Test void walksFromDraftToRestoredPublishingTheVerifiedBytes() throws IOException {
        var created = drafts.create(person, project, base.id(), "Probar una puerta alternativa");
        assertEquals(ChangeStatus.DRAFT, created.change().status());
        assertFalse(created.actions().submit());
        var id = created.change().id();
        var edited = drafts.addOperation(person, project, id, new ChangeType("op-9", DOOR, PROPOSED));
        assertEquals("op-1", edited.change().recipe().operations().getFirst().id(), "the server assigns the id");
        assertFalse(edited.reportCurrent());
        var previewed = drafts.preview(person, project, id);
        assertTrue(previewed.reportCurrent());
        assertTrue(previewed.previewAvailable());
        assertTrue(previewed.actions().submit());
        assertEquals(4, previewed.change().report().findings().size(), "the engine notice plus DoorRules");
        var ready = drafts.submit(person, project, id, "Puerta de igual medida");
        assertEquals(ChangeStatus.READY, ready.change().status());
        assertTrue(ready.actions().apply());

        pricing.replace(person, project, base.id(), new BigDecimal("0.8"), List.of(price(CURRENT, "100000"), price(PROPOSED, "125000")));
        assertEquals(0, new BigDecimal("25000").compareTo(drafts.get(person, project, id).estimate().total()), "live estimate");
        var previewSha = ready.change().preview().sha256();

        var applied = publish.apply(person, project, id);
        assertEquals(ChangeStatus.APPLIED, applied.change().status());
        var revision = versions.list(project, owner, base.fileId()).getFirst();
        assertEquals(2, revision.revision());
        assertEquals(previewSha, revision.sha256(), "the published revision is the approved preview");
        assertEquals(revision.id(), applied.change().applied().version());
        assertEquals(owner, applied.change().applied().by());
        assertEquals(0, new BigDecimal("25000").compareTo(applied.estimate().total()), "frozen estimate");
        var copied = pricing.read(person, project, revision.id()).prices();
        assertEquals(2, copied.size());
        assertTrue(copied.stream().allMatch(p -> base.id().equals(p.copiedFrom()) && p.source().equals("Cotización de prueba")
            && p.date().equals(LocalDate.parse("2026-11-20"))));
        assertTrue(fakes.previews.files.isEmpty(), "the published preview file is removed");
        assertSame(ChangeStatus.APPLIED, publish.apply(person, project, id).change().status(), "apply is idempotent");
        assertEquals(2, versions.list(project, owner, base.fileId()).size());

        var restored = publish.restore(person, project, id);
        assertEquals(ChangeStatus.RESTORED, restored.change().status());
        var third = versions.list(project, owner, base.fileId()).getFirst();
        assertEquals(3, third.revision());
        assertEquals(base.sha256(), third.sha256(), "restoring brings back the bytes of the base");
        assertTrue(pricing.read(person, project, third.id()).prices().stream().allMatch(p -> revision.id().equals(p.copiedFrom())));
        assertSame(ChangeStatus.RESTORED, publish.restore(person, project, id).change().status(), "restore is idempotent");
        assertEquals(List.of(Action.CREATE, Action.EDIT, Action.PREVIEW, Action.SUBMIT, Action.APPLY, Action.RESTORE), actions(id));
    }

    @Test void theAgentDraftsButNeverPublishesOrPrices() throws IOException {
        var run = UUID.randomUUID();
        var agent = Actor.agent(owner, project, run);
        var own = readyChange(agent);
        assertEquals(ChangeOrigin.AGENT, own.change().origin());
        assertEquals(ChangeStatus.READY, own.change().status());
        var id = own.change().id();
        assertFalse(own.actions().apply());
        assertThrows(ForbiddenApplicationException.class, () -> publish.apply(agent, project, id));
        assertThrows(ForbiddenApplicationException.class, () -> publish.restore(agent, project, id));
        assertThrows(ForbiddenApplicationException.class, () -> pricing.replace(agent, project, base.id(), null, List.of()));
        assertThrows(ForbiddenApplicationException.class, () -> pricing.copy(agent, project, base.id(), base.id()));
        assertEquals(ChangeStatus.READY, drafts.get(person, project, id).change().status(), "nothing moved");
        assertEquals(1, versions.list(project, owner, base.fileId()).size());

        assertThrows(ForbiddenApplicationException.class, () -> drafts.create(Actor.agent(owner, UUID.randomUUID(), run), project,
            base.id(), "Otro proyecto"));
        var mine = drafts.create(person, project, base.id(), "Cambio de la persona").change().id();
        assertThrows(ForbiddenApplicationException.class, () -> drafts.addOperation(agent, project, mine, new ChangeType(null, OTHER_DOOR, PROPOSED)));
        assertThrows(ForbiddenApplicationException.class, () -> drafts.discard(Actor.agent(owner, project, UUID.randomUUID()), project, id, null));
        var discarded = drafts.discard(agent, project, id, "El agente lo retira");
        assertEquals(Actor.Kind.AGENT, discarded.change().discarded().kind());
        var event = fakes.changes.events(id).getLast();
        assertEquals(ModelChangeEvent.ActorKind.AGENT, event.actorKind());
        assertEquals(run, event.agentRun());
    }

    @Test void theGateRejectsWhatTheEngineRejectsAndWhatIsNotEnabled() {
        var id = drafts.create(person, project, base.id(), "Puerta").change().id();
        fakes.engine.checks = recipe -> new ModelEnginePort.Checks(false, List.of(new PreviewReport.OperationResult("op-1", ChangeType.OP,
            false, DOOR, List.of(new PreviewReport.OperationError("TYPE_NOT_COMPATIBLE", "El tipo no cabe en el hueco.")), null, null, null)));
        var rejected = assertThrows(UnprocessableApplicationException.class,
            () -> drafts.addOperation(person, project, id, new ChangeType(null, DOOR, PROPOSED)));
        assertEquals("TYPE_NOT_COMPATIBLE", rejected.code());
        assertEquals("El tipo no cabe en el hueco.", rejected.getMessage());
        assertTrue(drafts.get(person, project, id).change().recipe().isEmpty());

        // Since step 11 (H2.1) ifc.set_property is enabled; the engine still rejects a text for a boolean.
        fakes.engine.checks = recipe -> new ModelEnginePort.Checks(false, List.of(new PreviewReport.OperationResult("op-1", SetProperty.OP,
            false, DOOR, List.of(new PreviewReport.OperationError("VALUE_TYPE", "IsExternal espera un booleano.")), null, null, null)));
        var text = new SetProperty(null, DOOR, PropertyScope.OCCURRENCE, "Pset_DoorCommon", "IsExternal", new PropertyValue.Text("si"), null);
        assertEquals("VALUE_TYPE", assertThrows(UnprocessableApplicationException.class,
            () -> drafts.addOperation(person, project, id, text)).code());
        fakes.engine.checks = null;
        var property = new SetProperty(null, DOOR, PropertyScope.OCCURRENCE, "Pset_DoorCommon", "FireRating", new PropertyValue.Text("EI 60"), null);
        assertEquals(SetProperty.OP, drafts.addOperation(person, project, id, property).change().recipe().operations().getFirst().op());
        drafts.removeOperation(person, project, id, "op-1");
        drafts.addOperation(person, project, id, new ChangeType(null, DOOR, PROPOSED));
        assertEquals("DUPLICATE_TARGET", assertThrows(InvalidRequestApplicationException.class,
            () -> drafts.addOperation(person, project, id, new ChangeType(null, DOOR, CURRENT))).code());
        var replaced = drafts.replaceOperation(person, project, id, "op-1", new ChangeType(null, DOOR, CURRENT));
        assertEquals(CURRENT, ((ChangeType) replaced.change().recipe().operations().getFirst()).typeId());
        assertThrows(NotFoundApplicationException.class, () -> drafts.replaceOperation(person, project, id, "op-7", new ChangeType(null, DOOR, PROPOSED)));
        assertTrue(drafts.removeOperation(person, project, id, "op-1").change().recipe().isEmpty());
    }

    @Test void anEditThatRacesAnotherOneConflictsInsteadOfLosingIt() {
        var id = drafts.create(person, project, base.id(), "Dos puertas").change().id();
        fakes.engine.checks = recipe -> {
            fakes.engine.checks = null;
            drafts.addOperation(person, project, id, new ChangeType(null, OTHER_DOOR, PROPOSED));
            return new ModelEnginePort.Checks(true, List.of());
        };
        var conflict = assertThrows(ConflictApplicationException.class,
            () -> drafts.addOperation(person, project, id, new ChangeType(null, DOOR, PROPOSED)));
        assertEquals("El cambio se modificó; recarga.", conflict.getMessage());
        var operations = drafts.get(person, project, id).change().recipe().operations();
        assertEquals(1, operations.size());
        assertEquals(OTHER_DOOR, operations.getFirst().element(), "the operation that won is kept");
    }

    @Test void previewRetriesOnceWhenTheEngineLostItsArtifact() {
        var id = drafts.create(person, project, base.id(), "Puerta").change().id();
        drafts.addOperation(person, project, id, new ChangeType(null, DOOR, PROPOSED));
        fakes.engine.corruptBuilds = 1;
        var recovered = drafts.preview(person, project, id);
        assertTrue(recovered.previewAvailable());
        assertEquals(2, fakes.engine.previews, "steps 2 and 3 ran twice");
        assertEquals(1, fakes.previews.files.size(), "only the verified file is left");

        fakes.engine.corruptBuilds = 2;
        var lost = assertThrows(EngineUnavailableException.class, () -> drafts.preview(person, project, id));
        assertEquals("PREVIEW_LOST", lost.code());
        var kept = drafts.get(person, project, id);
        assertEquals(recovered.change().preview(), kept.change().preview(), "the state did not change");
        assertEquals(1, fakes.previews.files.size());
        assertTrue(fakes.previews.files.containsKey(kept.change().preview().id()));
    }

    /**
     * §4.5, R1: preview and build share one budget per request. When the first attempt used more than what is left, the
     * retry would outlive the proxy, so it answers 503 PREVIEW_LOST at once; and no engine call gets more than the budget.
     */
    @Test void previewDoesNotRetryBeyondTheRequestBudget() {
        var tx = new Transactions() {
            public <T, E extends Exception> T required(Work<T, E> work) throws E { return work.run(); }
        };
        var budget = java.time.Duration.ofMillis(700);
        var tight = new ModelChanges(versions, fakes.changes, fakes.prices, fakes.previews, fakes.engine, fakes.doors, fakes.codec, tx,
            Clock.systemUTC(), budget);
        var id = tight.create(person, project, base.id(), "Puerta").change().id();
        tight.addOperation(person, project, id, new ChangeType(null, DOOR, PROPOSED));
        fakes.engine.corruptBuilds = 1;
        fakes.engine.buildPauseMillis = 400;
        var lost = assertThrows(EngineUnavailableException.class, () -> tight.preview(person, project, id));
        assertEquals("PREVIEW_LOST", lost.code());
        assertEquals(1, fakes.engine.previews, "no second attempt past the budget");
        assertTrue(fakes.previews.files.isEmpty(), "the unverified file is removed");
        assertNull(tight.get(person, project, id).change().preview());
        assertEquals(2, fakes.engine.timeouts.size());
        assertTrue(fakes.engine.timeouts.stream().allMatch(t -> t.compareTo(budget) <= 0 && !t.isZero()));
        assertTrue(fakes.engine.timeouts.get(1).compareTo(fakes.engine.timeouts.get(0)) <= 0, "build gets what preview left");

        // With the same budget and a fast engine the retry still fits.
        fakes.engine.buildPauseMillis = 0;
        fakes.engine.corruptBuilds = 1;
        assertTrue(tight.preview(person, project, id).previewAvailable());
        assertEquals(3, fakes.engine.previews);
    }

    @Test void aFailingPreviewSendsAReadyChangeBackToDraft() {
        var ready = readyChange(person);
        var id = ready.change().id();
        fakes.engine.verifies = false;
        var failed = drafts.preview(person, project, id);
        assertEquals(ChangeStatus.DRAFT, failed.change().status());
        assertFalse(failed.change().report().ok());
        assertNull(failed.change().preview());
        assertTrue(fakes.previews.files.isEmpty(), "the previous preview file is removed");
        assertEquals("PREVIEW_FAILED", assertThrows(UnprocessableApplicationException.class,
            () -> drafts.submit(person, project, id, null)).code());
        assertThrows(ConflictApplicationException.class, () -> publish.apply(person, project, id));
    }

    @Test void submitAndApplyNeedACurrentPreview() {
        var id = drafts.create(person, project, base.id(), "Puerta").change().id();
        assertEquals("RECIPE_EMPTY", assertThrows(UnprocessableApplicationException.class, () -> drafts.submit(person, project, id, null)).code());
        drafts.addOperation(person, project, id, new ChangeType(null, DOOR, PROPOSED));
        assertThrows(ConflictApplicationException.class, () -> drafts.submit(person, project, id, null), "no preview");
        var refused = assertThrows(ConflictApplicationException.class, () -> publish.apply(person, project, id));
        assertEquals("Previsualiza el cambio para aprobarlo.", refused.getMessage());
        drafts.preview(person, project, id);
        drafts.addOperation(person, project, id, new ChangeType(null, OTHER_DOOR, PROPOSED));
        assertThrows(ConflictApplicationException.class, () -> drafts.submit(person, project, id, null), "the recipe moved");
        drafts.preview(person, project, id);
        drafts.submit(person, project, id, null);
        assertThrows(ChangeStateException.class, () -> drafts.addOperation(person, project, id, new ChangeType(null, "0000000000000000000003", PROPOSED)));
    }

    @Test void publishingOneChangeMakesItsSiblingsStale() throws IOException {
        var first = readyChange(person).change().id();
        var second = readyChange(person).change().id();
        assertEquals(2, fakes.previews.files.size());
        publish.apply(person, project, first);
        var sibling = drafts.get(person, project, second);
        assertFalse(sibling.baseLatest());
        assertFalse(sibling.previewAvailable());
        assertNull(sibling.change().preview());
        assertFalse(sibling.actions().apply());
        assertTrue(sibling.actions().reasons().get("apply").contains("v2"));
        assertTrue(sibling.actions().discard());
        assertTrue(fakes.previews.files.isEmpty());
        var stale = assertThrows(ConflictApplicationException.class, () -> publish.apply(person, project, second));
        assertEquals("Abre la revisión más reciente para proponer o revertir un cambio.", stale.getMessage());
        assertEquals("La base ya no es la última revisión (v2).",
            assertThrows(ConflictApplicationException.class, () -> drafts.preview(person, project, second)).getMessage());
        assertEquals(ModelChangeEvent.ActorKind.SYSTEM, fakes.changes.events(second).getLast().actorKind());
        assertEquals(ChangeStatus.DISCARDED, drafts.discard(person, project, second, null).change().status());
        assertEquals(2, versions.list(project, owner, base.fileId()).size(), "a rejected change creates no version");
    }

    @Test void theDoorFacadeKeepsAnIncompatibleTypeAsADraft() throws IOException {
        Function<DoorReview, String> json = review -> "{\"door\":\"" + review.door().element() + "\"}";
        var picture = new byte[]{(byte) 137, 80, 78, 71};
        var ready = drafts.proposeDoor(person, project, base.id(), DOOR, PROPOSED, "Puerta alternativa", picture, json);
        assertEquals(ChangeStatus.READY, ready.change().status());
        assertEquals("{\"door\":\"" + DOOR + "\"}", ready.change().legacyReview());
        assertTrue(ready.change().picture());
        assertArrayEquals(picture, drafts.picture(person, project, ready.change().id()));
        assertEquals(0, fakes.engine.checksRun, "the facade skips the checks_only gate");

        fakes.engine.verifies = false;
        var draft = drafts.proposeDoor(person, project, base.id(), DOOR, PROPOSED, "Tipo incompatible", null, json);
        assertEquals(ChangeStatus.DRAFT, draft.change().status());
        assertFalse(draft.change().report().ok());
        assertEquals("TYPE_NOT_AVAILABLE", assertThrows(UnprocessableApplicationException.class,
            () -> drafts.proposeDoor(person, project, base.id(), DOOR, OTHER_DOOR, "Tipo ausente", null, json)).code());
        assertEquals(2, drafts.doorChanges(person, project).size());
        var review = drafts.doorReview(person, project, base.id(), DOOR, PROPOSED);
        assertEquals(3, review.findings().size());
        assertNull(review.estimate().difference(), "no prices yet");
    }

    @Test void anotherAccountSeesNothing() {
        var id = readyChange(person).change().id();
        var stranger = Actor.person(UUID.randomUUID());
        assertThrows(NotFoundApplicationException.class, () -> drafts.get(stranger, project, id));
        assertThrows(NotFoundApplicationException.class, () -> drafts.list(stranger, project, Set.of(), null));
        assertThrows(NotFoundApplicationException.class, () -> publish.apply(stranger, project, id));
        assertThrows(NotFoundApplicationException.class, () -> pricing.read(stranger, project, base.id()));
    }

    static UnitPrice price(String type, String amount) {
        return new UnitPrice(PriceKey.type(type), UnitPrice.Unit.UNIT, "COP", new BigDecimal(amount), "Cotización de prueba",
            LocalDate.parse("2026-11-20"), null);
    }

    static String sha(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** In-memory ports. */
    final class Fakes {
        final Map<UUID, ModelFile> fileRows = new HashMap<>();
        final List<ModelVersion> versionRows = new ArrayList<>();
        final Map<UUID, byte[]> originalBytes = new HashMap<>();
        final ChangeStore changes = new ChangeStore();
        final Prices prices = new Prices();
        final Previews previews = new Previews();
        final Engine engine = new Engine();
        final RecipeCodec codec = new RecipeCodec() {
            public Recipe recipe(String json) { throw new UnsupportedOperationException(); }
            public Operation operation(String json) { throw new UnsupportedOperationException(); }
            public String canonical(Recipe recipe) { return recipe.toString(); }
        };

        final ProjectRepository projects = new ProjectRepository() {
            public void save(Project value) { throw new UnsupportedOperationException(); }
            public Optional<Project> findById(ProjectId id, UserId user) {
                return id.value().equals(project) && user.value().equals(owner)
                    ? Optional.of(Project.restore(id, user, "Prueba", false, Instant.now())) : Optional.empty();
            }
            public Optional<Project> findForUpdate(ProjectId id, UserId user) { return findById(id, user); }
            public List<Project> findAll(UserId user) { throw new UnsupportedOperationException(); }
            public void delete(Project value) { throw new UnsupportedOperationException(); }
        };

        final ModelFileRepository files = new ModelFileRepository() {
            public void add(ModelFile file) { fileRows.put(file.id(), file); }
            public Optional<ModelFile> find(UUID p, UUID file) { return Optional.ofNullable(fileRows.get(file)).filter(f -> f.projectId().equals(p)); }
            public Optional<ModelFile> named(UUID p, String name) {
                return fileRows.values().stream().filter(f -> f.projectId().equals(p) && f.name().equals(name)).findFirst();
            }
            public List<ModelFile> list(UUID p) { return fileRows.values().stream().filter(f -> f.projectId().equals(p)).toList(); }
        };

        final VersionRepository versions = new VersionRepository() {
            public List<ModelVersion> history(UUID file) {
                return versionRows.stream().filter(v -> v.fileId().equals(file))
                    .sorted(Comparator.comparingInt(ModelVersion::revision).reversed()).toList();
            }
            public int nextRevision(UUID file) { return history(file).stream().mapToInt(ModelVersion::revision).max().orElse(0) + 1; }
            public void insert(ModelVersion version) { versionRows.add(version); }
            public Optional<ModelVersion> find(UUID p, UUID id) {
                return versionRows.stream().filter(v -> v.id().equals(id) && fileRows.get(v.fileId()).projectId().equals(p)).findFirst();
            }
            public Map<String, String> notes(UUID version) { return Map.of(); }
            public void writeNote(UUID version, String key, String text, boolean onlyIfAbsent) { }
        };

        final OriginalStorage originals = new OriginalStorage() {
            public Receipt write(UUID p, UUID version, String format, InputStream source) throws IOException {
                var bytes = source.readAllBytes();
                originalBytes.put(version, bytes);
                return new Receipt(bytes.length, sha(bytes));
            }
            public InputStream read(UUID p, UUID version) { return new ByteArrayInputStream(originalBytes.get(version)); }
        };

        final SecurityRepository users = new SecurityRepository() {
            public void register(SecurityUser user) { throw new UnsupportedOperationException(); }
            public Optional<SecurityUser> byEmail(String email) { throw new UnsupportedOperationException(); }
            public Optional<SecurityUser> byId(UUID id) {
                return id.equals(owner) ? Optional.of(new SecurityUser(owner, "ingeniera@example.test", "x", Role.DESIGNER)) : Optional.empty();
            }
            public void start(RefreshToken token) { throw new UnsupportedOperationException(); }
            public boolean rotate(RefreshToken current, UUID next) { throw new UnsupportedOperationException(); }
            public void revoke(RefreshToken current) { throw new UnsupportedOperationException(); }
            public boolean active(UUID sessionId, UUID userId) { return true; }
        };

        final BimEditPort doors = new BimEditPort() {
            public Door inspect(UUID p, UUID version, String element) {
                return new Door(element, "Puerta 1", CURRENT, "P76", new BigDecimal("0.762"), new BigDecimal("2.032"),
                    "0000000000000000000009", List.of(new BigDecimal("0.81"), new BigDecimal("2.06")), null, null,
                    List.of(new DoorType(PROPOSED, "P76B", new BigDecimal("0.762"), new BigDecimal("2.032"), true)));
            }
            public InputStream apply(UUID p, UUID version, String element, String typeId) { throw new UnsupportedOperationException(); }
        };
    }

    final class ChangeStore implements ModelChangeRepository {
        final Map<UUID, ModelChange> rows = new LinkedHashMap<>();
        final Map<UUID, byte[]> pictures = new HashMap<>();
        final List<ModelChangeEvent> log = new ArrayList<>();

        public Optional<ModelChange> find(UUID p, UUID id) { return Optional.ofNullable(rows.get(id)).filter(c -> c.project().equals(p)); }
        public Optional<ModelChange> findLockingProject(UUID p, UUID id) { return find(p, id); }
        public List<ModelChange> list(UUID p, Set<ChangeStatus> statuses, UUID file, int limit) {
            return rows.values().stream().filter(c -> c.project().equals(p) && (statuses.isEmpty() || statuses.contains(c.status()))
                && (file == null || file.equals(c.file()))).sorted(Comparator.comparing(ModelChange::createdAt).reversed()).limit(limit).toList();
        }
        public List<ModelChange> pending(UUID p, UUID file) {
            return rows.values().stream().filter(c -> c.project().equals(p) && c.file().equals(file) && c.status().pending()).toList();
        }
        public List<ModelChange> holdingPreviews() { return rows.values().stream().filter(c -> c.status().pending() && c.preview() != null).toList(); }
        public void insert(ModelChange change, byte[] picture) {
            rows.put(change.id(), change);
            if (picture != null) pictures.put(change.id(), picture);
        }
        public void update(ModelChange change) { rows.put(change.id(), change); }
        public void record(ModelChangeEvent event) { log.add(event); }
        public List<ModelChangeEvent> events(UUID change) { return log.stream().filter(e -> e.change().equals(change)).toList(); }
        public Optional<byte[]> picture(UUID p, UUID id) { return find(p, id).map(c -> pictures.get(id)); }
        public Map<UUID, String> emails(Collection<UUID> users) {
            return users.stream().filter(owner::equals).collect(Collectors.toMap(u -> u, u -> "ingeniera@example.test"));
        }
    }

    final class Prices implements PriceBook {
        final Map<UUID, Map<PriceKey, UnitPrice>> byVersion = new HashMap<>();
        BigDecimal minimum;

        public List<UnitPrice> prices(UUID p, UUID version) { return List.copyOf(byVersion.getOrDefault(version, Map.of()).values()); }
        public void put(UUID p, UUID version, UnitPrice price) { byVersion.computeIfAbsent(version, v -> new LinkedHashMap<>()).put(price.key(), price); }
        public Optional<BigDecimal> minimumWidth(UUID p) { return Optional.ofNullable(minimum); }
        public void minimumWidth(UUID p, BigDecimal width) { minimum = width; }
    }

    final class Previews implements PreviewStorage {
        final Map<UUID, byte[]> files = new LinkedHashMap<>();
        final Map<UUID, UUID> owners = new HashMap<>();

        public Stored write(UUID p, UUID change, UUID previewId, InputStream source) throws IOException {
            var bytes = source.readAllBytes();
            files.put(previewId, bytes);
            owners.put(previewId, change);
            return new Stored(previewId, sha(bytes), bytes.length);
        }
        public InputStream read(UUID p, UUID change, UUID previewId) throws IOException {
            var bytes = files.get(previewId);
            if (bytes == null) throw new IOException("missing");
            return new ByteArrayInputStream(bytes);
        }
        public boolean exists(UUID p, UUID change, UUID previewId) { return files.containsKey(previewId); }
        public void delete(UUID p, UUID change, UUID previewId) { files.remove(previewId); }
        public void deleteAll(UUID p, UUID change) { files.keySet().removeIf(id -> change.equals(owners.get(id))); }
    }

    /** The engine stub: a verified revision is {@code ISO-10303-21;} plus the recipe, so each recipe has its own SHA. */
    final class Engine implements ModelEnginePort {
        Function<Recipe, Checks> checks;
        boolean verifies = true;
        int corruptBuilds;
        int previews;
        int checksRun;
        /** How long {@code build} takes, to spend the request's budget. */
        long buildPauseMillis;
        /** The timeout each preview and build received. */
        final List<java.time.Duration> timeouts = new ArrayList<>();

        byte[] revised(Recipe recipe) { return ("ISO-10303-21;\n/* " + recipe + " */").getBytes(StandardCharsets.UTF_8); }

        public Map<String, Object> summary(VersionRef version) { return Map.of("schema", "IFC2X3"); }
        public Map<String, Object> elements(VersionRef version, ElementQuery query) { return Map.of("items", List.of()); }
        public Map<String, Object> element(VersionRef version, String guid) { return Map.of("guid", guid); }
        public Checks check(VersionRef base, Recipe recipe) {
            checksRun++;
            return checks == null ? new Checks(true, List.of()) : checks.apply(recipe);
        }
        public PreviewReport preview(VersionRef base, Recipe recipe) {
            previews++;
            var bytes = revised(recipe);
            var results = recipe.operations().stream().map(operation -> new PreviewReport.OperationResult(operation.id(), operation.op(),
                verifies, operation.element(), verifies ? List.of() : List.of(new PreviewReport.OperationError("TYPE_NOT_COMPATIBLE", "No cabe.")),
                inspected(operation), Map.of(), List.of())).toList();
            return new PreviewReport(verifies, "engine", verifies ? new PreviewReport.Artifact("a-" + previews, sha(bytes), bytes.length, null) : null,
                results, List.of(new com.obracota.domain.modelchange.model.report.Finding("ASSIGN_TYPE_CLEARED_ATTRIBUTES", "WARNING",
                    "Sin cambios en ObjectType.", "ifcopenshell", DOOR)), List.of(), Map.of("diff", Map.of()));
        }
        public PreviewReport preview(VersionRef base, Recipe recipe, java.time.Duration timeout) {
            timeouts.add(timeout);
            return preview(base, recipe);
        }
        public Build build(VersionRef base, Recipe recipe, String artifact, java.time.Duration timeout) {
            timeouts.add(timeout);
            if (buildPauseMillis > 0) {
                try {
                    Thread.sleep(buildPauseMillis);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            return build(base, recipe, artifact);
        }
        public Build build(VersionRef base, Recipe recipe, String artifact) {
            var bytes = revised(recipe);
            if (corruptBuilds > 0) {
                corruptBuilds--;
                bytes = (new String(bytes, StandardCharsets.UTF_8) + "/* rebuilt */").getBytes(StandardCharsets.UTF_8);
            }
            return new Build(new ByteArrayInputStream(bytes), bytes.length, sha(bytes), "engine", false);
        }
        public Map<String, Object> diff(UUID p, VersionRef base, VersionRef revision) { return Map.of(); }

        Map<String, Object> inspected(Operation operation) {
            if (!(operation instanceof ChangeType change)) return Map.of();
            return Map.of("element", change.element(), "name", "Puerta", "typeId", CURRENT, "width", 0.762, "height", 2.032,
                "openingSize", List.of(0.81, 2.06),
                "options", List.of(Map.of("id", PROPOSED, "name", "P76B", "width", 0.762, "height", 2.032, "compatible", true)));
        }
    }
}
