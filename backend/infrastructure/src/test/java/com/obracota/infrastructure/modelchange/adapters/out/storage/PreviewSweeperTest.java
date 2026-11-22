package com.obracota.infrastructure.modelchange.adapters.out.storage;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.ConflictApplicationException;
import com.obracota.application.common.exception.EngineUnavailableException;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.port.ModelChangeRepository;
import com.obracota.domain.modelversion.port.VersionRepository;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.security.model.Actor;
import com.obracota.infrastructure.modelchange.ModelChangeStubs;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

import static com.obracota.infrastructure.modelchange.ModelChangeStubs.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * J18: with a fixed clock, the sweeper removes an orphan older than an hour and an old {@code .part}, keeps the file of a
 * {@code READY} change and clears the preview of a {@code DRAFT} idle for 24 h. A {@code /build} stream cut halfway
 * (a 503) leaves neither the file nor the {@code .part}.
 */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test") @Import(ModelChangeStubs.Beans.class)
class PreviewSweeperTest {
    @TempDir static Path root;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) { r.add("models.directory", () -> root.toString()); }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired ModelChanges changes;
    @Autowired PreviewSweeper sweeper;
    @Autowired PreviewVolumeStorage storage;
    @Autowired MutableClock clock;
    @Autowired Engine engine;
    @Autowired ModelChangeRepository repository;
    @Autowired VersionRepository versions;
    @Autowired Transactions tx;

    @Test void sweepsOrphansPartsAndIdleDraftsButKeepsReadyPreviews() throws Exception {
        clock.set(Instant.now());
        var email = UUID.randomUUID() + "@example.test";
        var auth = json.readTree(mvc.perform(post("/api/auth/register").header("X-ObraCota-Client", "web").contentType("application/json")
            .content(json.writeValueAsBytes(Map.of("email", email, "password", "UnaClaveDePrueba!")))).andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString());
        var token = "Bearer " + auth.get("accessToken").asText();
        var project = UUID.fromString(json.readTree(mvc.perform(post("/api/projects").header("Authorization", token).contentType("application/json")
            .content("{\"name\":\"Barrido\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText());
        var version = UUID.fromString(json.readTree(mvc.perform(post("/api/projects/" + project + "/uploads").queryParam("name", "Duplex.ifc")
            .header("Authorization", token).contentType("application/octet-stream").content("ISO-10303-21;"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText());
        var actor = Actor.person(db.queryForObject("select id from security_user where email=?", UUID.class, email));

        var draft = changes.create(actor, project, version, "Borrador que se queda quieto").change().id();
        changes.addOperation(actor, project, draft, new ChangeType(null, DOOR, ALTERNATE));
        var draftPreview = changes.preview(actor, project, draft).change().preview();
        assertNotNull(draftPreview);
        var ready = changes.create(actor, project, version, "Cambio listo para aprobar").change().id();
        changes.addOperation(actor, project, ready, new ChangeType(null, DOOR, ALTERNATE));
        changes.preview(actor, project, ready);
        var readyPreview = changes.submit(actor, project, ready, null).change().preview();
        assertEquals(ChangeStatus.READY, changes.get(actor, project, ready).change().status());

        var folder = storage.root().resolve(project.toString());
        var draftFile = folder.resolve(draft.toString()).resolve(draftPreview.id() + ".ifc");
        var readyFile = folder.resolve(ready.toString()).resolve(readyPreview.id() + ".ifc");
        var stray = folder.resolve(UUID.randomUUID().toString());
        Files.createDirectories(stray);
        var orphan = Files.writeString(stray.resolve(UUID.randomUUID() + ".ifc"), "ISO-10303-21;");
        var part = Files.writeString(folder.resolve(draft.toString()).resolve(UUID.randomUUID() + ".ifc.part"), "ISO-");
        var young = Files.writeString(stray.resolve(UUID.randomUUID() + ".ifc"), "ISO-10303-21;");
        var old = FileTime.from(clock.instant().minus(Duration.ofHours(2)));
        Files.setLastModifiedTime(orphan, old);
        Files.setLastModifiedTime(part, old);

        // Now: the old orphan and the old .part go; a file younger than an hour and both referenced previews stay.
        sweeper.sweep();
        assertFalse(Files.exists(orphan));
        assertFalse(Files.exists(part));
        assertTrue(Files.exists(young));
        assertTrue(Files.exists(draftFile));
        assertTrue(Files.exists(readyFile));
        assertNotNull(changes.get(actor, project, draft).change().preview());

        // 25 h later: the idle DRAFT loses its preview (row and file, with a SYSTEM event); the READY keeps it.
        clock.advance(Duration.ofHours(25));
        sweeper.sweep();
        var swept = changes.get(actor, project, draft);
        assertNull(swept.change().preview());
        assertFalse(swept.previewAvailable());
        assertNotNull(swept.change().report());
        assertFalse(swept.actions().submit());
        assertFalse(Files.exists(draftFile));
        assertEquals(1, db.queryForObject("select count(*) from model_change_event where change_id=? and action='PREVIEW_CLEARED'"
            + " and actor_kind='SYSTEM' and actor_user is null", Integer.class, draft));
        assertTrue(Files.exists(readyFile));
        assertTrue(changes.get(actor, project, ready).previewAvailable());
        assertFalse(Files.exists(young));

        // A /build stream cut halfway is a 503 and leaves nothing behind, neither the file nor the .part.
        var cut = changes.create(actor, project, version, "Flujo cortado").change().id();
        changes.addOperation(actor, project, cut, new ChangeType(null, DOOR, ALTERNATE));
        engine.mode = Mode.CUT;
        try {
            assertThrows(EngineUnavailableException.class, () -> changes.preview(actor, project, cut));
        } finally {
            engine.mode = Mode.OK;
        }
        var cutFolder = folder.resolve(cut.toString());
        try (var left = Files.exists(cutFolder) ? Files.list(cutFolder) : java.util.stream.Stream.<Path>empty()) {
            assertEquals(List.of(), left.toList());
        }
        var after = changes.get(actor, project, cut).change();
        assertEquals(ChangeStatus.DRAFT, after.status());
        assertNull(after.report());
        assertNull(after.preview());
        assertEquals("ISO-10303-21;", new String(Files.readAllBytes(storage.root().getParent().resolve(project.toString()).resolve(version.toString())),
            StandardCharsets.UTF_8));
    }

    /**
     * The sweeper reads and writes the row under the project lock the use cases take. A submit that arrives between its
     * read and its write waits for it, then finds no preview (409), instead of committing READY and being overwritten
     * by the sweeper's stale copy.
     */
    @Test void aSubmitDuringTheSweepWaitsAndIsNotOverwritten() throws Exception {
        clock.set(Instant.now());
        var email = UUID.randomUUID() + "@example.test";
        var auth = json.readTree(mvc.perform(post("/api/auth/register").header("X-ObraCota-Client", "web").contentType("application/json")
            .content(json.writeValueAsBytes(Map.of("email", email, "password", "UnaClaveDePrueba!")))).andExpect(status().isCreated())
            .andReturn().getResponse().getContentAsString());
        var token = "Bearer " + auth.get("accessToken").asText();
        var project = UUID.fromString(json.readTree(mvc.perform(post("/api/projects").header("Authorization", token).contentType("application/json")
            .content("{\"name\":\"Barrido concurrente\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText());
        var version = UUID.fromString(json.readTree(mvc.perform(post("/api/projects/" + project + "/uploads").queryParam("name", "Duplex.ifc")
            .header("Authorization", token).contentType("application/octet-stream").content("ISO-10303-21;"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText());
        var actor = Actor.person(db.queryForObject("select id from security_user where email=?", UUID.class, email));
        var draft = changes.create(actor, project, version, "Borrador que se envía durante el barrido").change().id();
        changes.addOperation(actor, project, draft, new ChangeType(null, DOOR, ALTERNATE));
        assertNotNull(changes.preview(actor, project, draft).change().preview());
        clock.advance(Duration.ofHours(25));

        var submit = new java.util.concurrent.CompletableFuture<Object>();
        var waited = new java.util.concurrent.atomic.AtomicBoolean();
        var interleaving = (ModelChangeRepository) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[] {ModelChangeRepository.class}, (proxy, method, args) -> {
                if (method.getName().equals("update") && args[0] instanceof ModelChange row && row.id().equals(draft) && !submit.isDone()
                    && !waited.get()) {
                    // The sweeper has read the row and is about to write it: the engineer submits right now.
                    var thread = new Thread(() -> {
                        try {
                            submit.complete(changes.submit(actor, project, draft, null));
                        } catch (Throwable e) {
                            submit.complete(e);
                        }
                    });
                    thread.start();
                    thread.join(400);
                    waited.set(thread.isAlive());
                }
                try {
                    return method.invoke(repository, args);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    throw e.getCause();
                }
            });
        var sweeping = new PreviewSweeper(storage, interleaving, versions, tx, clock);

        var result = sweeping.sweep();
        assertTrue(result.cleared() >= 1);
        assertTrue(waited.get(), "the submit waited for the sweeper's lock");
        var answer = submit.get(10, java.util.concurrent.TimeUnit.SECONDS);
        var conflict = assertInstanceOf(ConflictApplicationException.class, answer);
        assertEquals("La vista previa ya no está disponible; previsualiza el cambio de nuevo.", conflict.getMessage());
        var after = changes.get(actor, project, draft).change();
        assertEquals(ChangeStatus.DRAFT, after.status());
        assertNull(after.preview());
        assertNotNull(after.report(), "the report is kept");
        assertEquals(0, db.queryForObject("select count(*) from model_change_event where change_id=? and action='SUBMIT'", Integer.class, draft));
        assertEquals(1, db.queryForObject("select count(*) from model_change_event where change_id=? and action='PREVIEW_CLEARED'",
            Integer.class, draft));
    }
}
