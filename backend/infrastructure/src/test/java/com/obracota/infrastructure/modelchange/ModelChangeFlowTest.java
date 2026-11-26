package com.obracota.infrastructure.modelchange;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.EngineUnavailableException;
import com.obracota.application.common.exception.ForbiddenApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.application.modelchange.usecase.VersionPrices;
import com.obracota.domain.security.model.Actor;
import com.obracota.domain.security.port.service.TokenService;
import com.obracota.infrastructure.designchange.DesignChangeController;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static com.obracota.infrastructure.modelchange.ModelChangeStubs.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The REST API of model changes, readings and prices (§4.2-§4.5) with the engine stubbed (§8.2):
 * J1, J2, J4, J6, J7, J8, J9, J10, J15, J16 and J17.
 */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test") @Import(ModelChangeStubs.Beans.class)
class ModelChangeFlowTest {
    static final String ORIGINAL = "ISO-10303-21;";
    static final String OTHER_DOOR = "1hOSvn6df7F8_7GcBWlS8A";

    @TempDir static Path root;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) { r.add("models.directory", () -> root.toString()); }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired Engine engine;
    @Autowired MutableClock clock;
    @Autowired TokenService tokens;
    @Autowired PublishModelChange publish;
    @Autowired VersionPrices pricing;
    @Autowired DesignChangeController facade;
    @Value("${security.jwt-secret}") String secret;

    @AfterEach void resetEngine() { engine.reset(); }

    /** One account with one project and its first IFC revision. */
    final class Site {
        final String user = register();
        final String project = read(perform(post("/api/projects").contentType("application/json").content("{\"name\":\"Obra H1\"}"), user)
            .andExpect(status().isCreated())).get("id").asText();
        final String base = "/api/projects/" + project;
        final String changes = base + "/model-changes";
        final JsonNode v1 = upload(ORIGINAL, null);
        final String file = v1.get("fileId").asText();

        Site() throws Exception {}

        JsonNode upload(String body, String fileId) throws Exception {
            var request = post(base + "/uploads").queryParam("name", "Duplex.ifc").contentType("application/octet-stream").content(body);
            if (fileId != null) request.queryParam("file", fileId);
            return read(perform(request, user).andExpect(status().isCreated()));
        }

        ResultActions as(MockHttpServletRequestBuilder request) { return perform(request, user); }

        JsonNode create(String version, String description) throws Exception {
            clock.advance(Duration.ofSeconds(1));
            return read(as(post(changes).contentType("application/json")
                .content(write(Map.of("baseVersion", version, "description", description)))).andExpect(status().isCreated()));
        }

        ResultActions addOperation(String id, String element, String type) throws Exception {
            return as(post(changes + "/" + id + "/operations").contentType("application/json").content(changeType(element, type)));
        }

        ResultActions action(String id, String action) { return as(post(changes + "/" + id + "/" + action)); }

        JsonNode change(String id) throws Exception { return read(as(get(changes + "/" + id)).andExpect(status().isOk())); }

        /** A change in READY over {@code version}: one operation, an ok preview and submitted. */
        JsonNode ready(String version, String element) throws Exception {
            var id = create(version, "Probar una puerta alternativa").get("id").asText();
            addOperation(id, element, ALTERNATE).andExpect(status().isCreated());
            action(id, "preview").andExpect(status().isOk()).andExpect(jsonPath("$.report.ok").value(true));
            return read(action(id, "submit").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY")));
        }

        List<String> events(String id) {
            return db.queryForList("select action from model_change_event where change_id=? order by id", String.class, UUID.fromString(id));
        }

        int revisions() throws Exception { return read(as(get(base + "/files/" + file + "/versions")).andExpect(status().isOk())).size(); }

        Path previewFile(String change, String previewId) {
            return root.resolve(".previews").resolve(project).resolve(change).resolve(previewId + ".ifc");
        }

        String previewId(String change) {
            var id = db.queryForObject("select preview_id from model_change where id=?", UUID.class, UUID.fromString(change));
            return id == null ? null : id.toString();
        }
    }

    // J1 ---------------------------------------------------------------------------------------------------------------

    @Test void walksEveryState() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();

        var draft = site.create(v1, "Probar una puerta alternativa con el mismo hueco");
        var id = draft.get("id").asText();
        assertEquals("DRAFT", draft.get("status").asText());
        assertEquals("PERSON", draft.get("origin").asText());
        assertEquals(1, draft.get("baseRevision").asInt());
        assertEquals("Duplex.ifc", draft.get("baseName").asText());
        assertEquals(site.file, draft.get("file").asText());
        assertTrue(draft.at("/author/email").asText().endsWith("@example.test"));
        assertEquals(0, draft.at("/recipe/operations").size());
        assertTrue(draft.get("report").isNull());
        assertFalse(draft.get("reportCurrent").asBoolean());
        assertFalse(draft.at("/preview/available").asBoolean());
        assertFalse(draft.at("/actions/submit").asBoolean());
        assertEquals("Pendiente: añade al menos una operación", draft.at("/actions/reasons/submit").asText());
        site.as(get(site.changes + "/" + id)).andExpect(header().string("Cache-Control", "no-store"));

        var edited = read(site.addOperation(id, DOOR, ALTERNATE).andExpect(status().isCreated())
            .andExpect(header().string("Cache-Control", "no-store")));
        assertEquals("op-1", edited.at("/recipe/operations/0/id").asText());
        assertEquals(ALTERNATE, edited.at("/recipe/operations/0/type_id").asText());
        assertEquals("Pendiente: previsualiza el cambio para enviarlo", edited.at("/actions/reasons/submit").asText());

        var previewed = read(site.action(id, "preview").andExpect(status().isOk()));
        assertTrue(previewed.at("/report/ok").asBoolean());
        assertTrue(previewed.get("reportCurrent").asBoolean());
        assertTrue(previewed.at("/preview/available").asBoolean());
        assertTrue(previewed.at("/actions/submit").asBoolean());
        assertEquals("DRAFT", previewed.get("status").asText());
        var previewSha = previewed.at("/preview/sha256").asText();

        // The verified IFC downloads as <base>-propuesta.ifc with the SHA-256 the change stores.
        var download = site.as(get(site.changes + "/" + id + "/preview")).andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(content().contentType("application/octet-stream")).andReturn().getResponse();
        assertTrue(download.getHeader("Content-Disposition").contains("Duplex-propuesta.ifc"));
        assertEquals(previewSha, sha256Hex(download.getContentAsByteArray()));

        var ready = read(site.as(post(site.changes + "/" + id + "/submit").contentType("application/json")
            .content("{\"summary\":\"Mismo hueco, otra hoja\"}")).andExpect(status().isOk()));
        assertEquals("READY", ready.get("status").asText());
        assertEquals("Mismo hueco, otra hoja", ready.get("summary").asText());
        assertTrue(ready.at("/actions/apply").asBoolean());
        assertFalse(ready.at("/actions/edit").asBoolean());

        // A READY change rejected without creating a version, and a draft discarded.
        var rejected = site.ready(v1, OTHER_DOOR).get("id").asText();
        var reject = read(site.as(post(site.changes + "/" + rejected + "/discard").contentType("application/json")
            .content("{\"reason\":\"No convence\"}")).andExpect(status().isOk()));
        assertEquals("DISCARDED", reject.get("status").asText());
        assertEquals("PERSON", reject.at("/discardedBy/kind").asText());
        assertTrue(reject.at("/discardedBy/email").asText().endsWith("@example.test"));
        assertFalse(reject.at("/preview/available").asBoolean());
        assertEquals(1, site.revisions());
        var dropped = site.create(v1, "Borrador que no sigue").get("id").asText();
        site.action(dropped, "discard").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DISCARDED"));
        site.action(dropped, "discard").andExpect(status().isConflict());

        var applied = read(site.action(id, "apply").andExpect(status().isOk()));
        assertEquals("APPLIED", applied.get("status").asText());
        var v2 = applied.get("appliedVersion").asText();
        var revision = read(site.as(get(site.base + "/versions/" + v2)).andExpect(status().isOk()));
        assertEquals(2, revision.get("revision").asInt());
        assertEquals(previewSha, revision.get("sha256").asText());
        assertEquals(applied.at("/author/id").asText(), applied.at("/appliedBy/id").asText());
        assertFalse(applied.at("/preview/available").asBoolean());
        site.action(id, "apply").andExpect(status().isOk()).andExpect(jsonPath("$.appliedVersion").value(v2));

        var restored = read(site.action(id, "restore").andExpect(status().isOk()));
        assertEquals("RESTORED", restored.get("status").asText());
        assertFalse(restored.at("/actions/restore").asBoolean());
        site.action(id, "restore").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("RESTORED"));
        assertEquals(3, site.revisions());

        assertEquals(List.of("CREATE", "EDIT", "PREVIEW", "SUBMIT", "APPLY", "RESTORE"), site.events(id));
        assertEquals(List.of("CREATE", "EDIT", "PREVIEW", "SUBMIT", "DISCARD"), site.events(rejected));
        assertEquals(List.of("CREATE", "DISCARD"), site.events(dropped));

        // Listing and filters.
        var all = read(site.as(get(site.changes)).andExpect(status().isOk()));
        assertEquals(3, all.size());
        assertEquals(dropped, all.get(0).get("id").asText());
        var discarded = read(site.as(get(site.changes).param("status", "DISCARDED").param("file", site.file)).andExpect(status().isOk()));
        assertEquals(Set.of(rejected, dropped), ids(discarded));
        site.as(get(site.changes).param("status", "DRAFT,PERDIDO")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("STATUS_INVALID"));
    }

    // J2 ---------------------------------------------------------------------------------------------------------------

    @Test void applyOnStaleBaseConflicts() throws Exception {
        var site = new Site();
        var id = site.ready(site.v1.get("id").asText(), DOOR).get("id").asText();
        site.upload(ORIGINAL + "\n/* manual */", site.file);
        site.action(id, "apply").andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("Abre la revisión más reciente para proponer o revertir un cambio."));
        assertEquals("READY", site.change(id).get("status").asText());
        assertEquals(2, site.revisions());
    }

    // J4 ---------------------------------------------------------------------------------------------------------------

    @Test void restoreCreatesRevisionWithBaseSha() throws Exception {
        var site = new Site();
        var id = site.ready(site.v1.get("id").asText(), DOOR).get("id").asText();
        var applied = read(site.action(id, "apply").andExpect(status().isOk()));
        assertNotEquals(site.v1.get("sha256").asText(),
            read(site.as(get(site.base + "/versions/" + applied.get("appliedVersion").asText()))).get("sha256").asText());
        var restored = read(site.action(id, "restore").andExpect(status().isOk()));
        var v3 = read(site.as(get(site.base + "/versions/" + restored.get("restoredVersion").asText())).andExpect(status().isOk()));
        assertEquals(3, v3.get("revision").asInt());
        assertEquals(site.v1.get("sha256").asText(), v3.get("sha256").asText());
        assertEquals(sha256Hex(ORIGINAL.getBytes(StandardCharsets.UTF_8)), v3.get("sha256").asText());
        assertEquals(restored.at("/author/id").asText(), restored.at("/restoredBy/id").asText());
        assertFalse(restored.get("restoredAt").isNull());
    }

    // J6 ---------------------------------------------------------------------------------------------------------------

    @Test void pricesAreCopiedWithSourceAndDate() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();
        var prices = Map.of("prices", List.of(
            Map.of("key", "type:" + CURRENT, "unit", "UNIT", "amount", 100000, "source", "Cotización de prueba", "date", "2026-11-20"),
            Map.of("key", "type:" + ALTERNATE, "unit", "UNIT", "amount", 125000, "source", "Cotización de prueba", "date", "2026-11-20")));
        var put = read(site.as(put(site.base + "/versions/" + v1 + "/prices").contentType("application/json").content(write(prices)))
            .andExpect(status().isOk()));
        assertEquals(2, put.get("prices").size());
        for (var price : put.get("prices")) {
            assertEquals("COP", price.get("currency").asText());
            assertTrue(price.get("copiedFrom").isNull());
        }
        site.as(put(site.base + "/versions/" + v1 + "/prices").contentType("application/json")
            .content("{\"prices\":[{\"key\":\"tipo:malo\",\"unit\":\"UNIT\",\"amount\":1,\"source\":\"x\",\"date\":\"2026-11-20\"}]}"))
            .andExpect(status().isBadRequest());
        site.as(put(site.base + "/versions/" + v1 + "/prices").contentType("application/json")
            .content("{\"prices\":[{\"key\":\"item:Sobrecosto\",\"unit\":\"UNIT\",\"amount\":-1,\"source\":\"x\",\"date\":\"2026-11-20\"}]}"))
            .andExpect(status().isBadRequest());

        var id = site.ready(v1, DOOR).get("id").asText();
        var estimate = site.change(id).at("/report/estimate");
        assertEquals(25000, estimate.get("total").asInt());
        assertTrue(estimate.get("complete").asBoolean());
        assertEquals("Cotización de prueba", estimate.at("/lines/0/after/source").asText());
        assertEquals("2026-11-20", estimate.at("/lines/0/after/date").asText());

        var applied = read(site.action(id, "apply").andExpect(status().isOk()));
        var v2 = applied.get("appliedVersion").asText();
        assertEquals(25000, applied.at("/report/estimate/total").asInt());
        assertCopies(site, v2, v1);

        var v3 = read(site.action(id, "restore").andExpect(status().isOk())).get("restoredVersion").asText();
        assertCopies(site, v3, v2);
        // The estimate stays the one frozen on approval.
        assertEquals(25000, site.change(id).at("/report/estimate/total").asInt());
    }

    void assertCopies(Site site, String version, String from) throws Exception {
        var list = read(site.as(get(site.base + "/versions/" + version + "/prices")).andExpect(status().isOk())).get("prices");
        assertEquals(2, list.size());
        var amounts = new HashMap<String, Integer>();
        for (var price : list) {
            amounts.put(price.get("key").asText(), price.get("amount").asInt());
            assertEquals("Cotización de prueba", price.get("source").asText());
            assertEquals("2026-11-20", price.get("date").asText());
            assertEquals("UNIT", price.get("unit").asText());
            assertEquals(from, price.get("copiedFrom").asText());
        }
        assertEquals(Map.of("type:" + CURRENT, 100000, "type:" + ALTERNATE, 125000), amounts);
    }

    @Test void pricesCopyOnlyFromAnEarlierRevisionOfTheSameFile() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();
        site.as(put(site.base + "/versions/" + v1 + "/prices").contentType("application/json")
            .content("{\"minimumWidthM\":0.8,\"prices\":[{\"key\":\"item:Herraje antipánico\",\"unit\":\"UNIT\",\"amount\":45000,"
                + "\"source\":\"Catálogo de prueba\",\"date\":\"2026-11-19\"}]}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.minimumWidthM").value(0.8));
        var v2 = site.upload(ORIGINAL + "\n/* manual */", site.file).get("id").asText();
        site.as(get(site.base + "/versions/" + v2 + "/prices")).andExpect(status().isOk()).andExpect(jsonPath("$.prices.length()").value(0));
        site.as(post(site.base + "/versions/" + v2 + "/prices/copy").param("from", v1)).andExpect(status().isOk())
            .andExpect(jsonPath("$.prices[0].key").value("item:Herraje antipánico"))
            .andExpect(jsonPath("$.prices[0].copiedFrom").value(v1));
        site.as(post(site.base + "/versions/" + v1 + "/prices/copy").param("from", v2)).andExpect(status().isBadRequest());
        var other = read(site.as(post(site.base + "/uploads").queryParam("name", "Estructura.ifc").contentType("application/octet-stream")
            .content(ORIGINAL)).andExpect(status().isCreated())).get("id").asText();
        site.as(post(site.base + "/versions/" + other + "/prices/copy").param("from", v1)).andExpect(status().isConflict());
    }

    // J7 ---------------------------------------------------------------------------------------------------------------

    @Test void submitRequiresCurrentOkPreview() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();

        // No preview: 409.
        var id = site.create(v1, "Sin vista previa").get("id").asText();
        site.addOperation(id, DOOR, ALTERNATE).andExpect(status().isCreated());
        site.action(id, "submit").andExpect(status().isConflict());

        // A failed preview: 422, and the change keeps its report.
        var failing = site.create(v1, "Tipo incompatible").get("id").asText();
        site.addOperation(failing, DOOR, INCOMPATIBLE).andExpect(status().isCreated());
        var failed = read(site.action(failing, "preview").andExpect(status().isOk()));
        assertFalse(failed.at("/report/ok").asBoolean());
        assertEquals("TYPE_NOT_COMPATIBLE", failed.at("/report/operations/0/errors/0/code").asText());
        assertFalse(failed.at("/preview/available").asBoolean());
        assertEquals("Pendiente: la vista previa no superó las comprobaciones", failed.at("/actions/reasons/submit").asText());
        site.action(failing, "submit").andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.message").value("La vista previa no superó las comprobaciones."));

        // Another operation after an ok preview: the preview is no longer current, 409.
        site.action(id, "preview").andExpect(status().isOk());
        site.addOperation(id, OTHER_DOOR, ALTERNATE).andExpect(status().isCreated())
            .andExpect(jsonPath("$.reportCurrent").value(false)).andExpect(jsonPath("$.recipe.operations[1].id").value("op-2"));
        site.action(id, "submit").andExpect(status().isConflict());

        // Editing the recipe: replace keeps the id, a repeated target is 400, an unknown operation 404, a disabled one 422.
        site.as(put(site.changes + "/" + id + "/operations/op-2").contentType("application/json").content(changeType(OTHER_DOOR, INCOMPATIBLE)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.recipe.operations[1].type_id").value(INCOMPATIBLE));
        site.addOperation(id, DOOR, INCOMPATIBLE).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("DUPLICATE_TARGET"));
        site.as(put(site.changes + "/" + id + "/operations/op-9").contentType("application/json").content(changeType(OTHER_DOOR, ALTERNATE)))
            .andExpect(status().isNotFound());
        site.as(post(site.changes + "/" + id + "/operations").contentType("application/json").content(
            "{\"op\":\"ifc.remove_element\",\"element\":\"" + DOOR + "\"}"))
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("OPERATION_NOT_ENABLED"));
        site.as(post(site.changes + "/" + id + "/operations").contentType("application/json").content("{\"op\":\"ifc.change_type\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("RECIPE_INVALID"));
        site.as(delete(site.changes + "/" + id + "/operations/op-2")).andExpect(status().isOk())
            .andExpect(jsonPath("$.recipe.operations.length()").value(1));
        site.as(delete(site.changes + "/" + id + "/operations/op-2")).andExpect(status().isNotFound());

        // With a current ok preview it goes to READY; then the recipe is frozen.
        site.action(id, "preview").andExpect(status().isOk());
        site.action(id, "submit").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY"));
        site.addOperation(id, OTHER_DOOR, ALTERNATE).andExpect(status().isConflict());
        site.as(delete(site.changes + "/" + id + "/operations/op-1")).andExpect(status().isConflict());

        // Previewing a READY change again: ok keeps it READY, a failure sends it back to DRAFT. Each leaves its event.
        site.action(id, "preview").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY"));
        engine.rejectAll = true;
        site.action(id, "preview").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DRAFT"))
            .andExpect(jsonPath("$.report.ok").value(false));
        engine.rejectAll = false;
        var events = site.events(id);
        assertEquals(List.of("PREVIEW", "PREVIEW"), events.subList(events.size() - 2, events.size()));
        assertEquals(4, Collections.frequency(events, "PREVIEW"));
        assertEquals("La vista previa no superó las comprobaciones; el cambio vuelve a borrador.",
            db.queryForObject("select detail from model_change_event where change_id=? order by id desc limit 1", String.class, UUID.fromString(id)));

        // An empty recipe is never submitted.
        var empty = site.create(v1, "Vacío").get("id").asText();
        site.action(empty, "preview").andExpect(status().isOk());
        site.action(empty, "submit").andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("RECIPE_EMPTY"));
    }

    // J8 ---------------------------------------------------------------------------------------------------------------

    @Test void publishedBytesMatchPreview() throws Exception {
        var site = new Site();
        var id = site.ready(site.v1.get("id").asText(), DOOR).get("id").asText();
        var file = site.previewFile(id, site.previewId(id));
        var bytes = Files.readAllBytes(file);
        bytes[bytes.length - 3] = (byte) (bytes[bytes.length - 3] == 'x' ? 'y' : 'x');
        Files.write(file, bytes);

        site.action(id, "apply").andExpect(status().isConflict());
        assertEquals("READY", site.change(id).get("status").asText());
        assertEquals(1, site.revisions());
        try (var stored = Files.list(root.resolve(site.project))) { assertEquals(1, stored.count()); }
        assertFalse(site.events(id).contains("APPLY"));
    }

    // J9 ---------------------------------------------------------------------------------------------------------------

    @Test void engineDownKeepsState() throws Exception {
        var site = new Site();
        var id = site.ready(site.v1.get("id").asText(), DOOR).get("id").asText();
        var before = site.change(id);
        int events = site.events(id).size();

        engine.failure = new EngineUnavailableException(null, "El motor IFC no está disponible.");
        site.action(id, "preview").andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.message").value("El motor IFC no está disponible.")).andExpect(jsonPath("$.code").doesNotExist());
        engine.failure = new EngineUnavailableException("ENGINE_BUSY", "El motor IFC está ocupado; vuelve a intentarlo.");
        site.action(id, "preview").andExpect(status().isServiceUnavailable())
            .andExpect(header().string("Retry-After", "5")).andExpect(jsonPath("$.code").value("ENGINE_BUSY"));
        engine.failure = new UnprocessableApplicationException("MODEL_TOO_LARGE", "El modelo supera el tamaño que H1 puede verificar (190 MB).");
        site.action(id, "preview").andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("MODEL_TOO_LARGE"))
            .andExpect(jsonPath("$.message").value("El modelo supera el tamaño que H1 puede verificar (190 MB)."));

        var after = site.change(id);
        assertEquals("READY", after.get("status").asText());
        assertEquals(before.get("report"), after.get("report"));
        assertEquals(before.get("preview"), after.get("preview"));
        assertTrue(after.at("/preview/available").asBoolean());
        assertEquals(events, site.events(id).size());
    }

    // J10 --------------------------------------------------------------------------------------------------------------

    @Test void otherAccountGets404() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();
        var id = site.ready(v1, DOOR).get("id").asText();
        var stranger = register();
        var version = site.base + "/versions/" + v1;
        for (var request : List.of(get(site.changes), get(site.changes + "/" + id), get(site.changes + "/" + id + "/preview"),
                get(site.changes + "/" + id + "/picture"),
                post(site.changes).contentType("application/json").content(write(Map.of("baseVersion", v1, "description", "Ajeno"))),
                post(site.changes + "/" + id + "/operations").contentType("application/json").content(changeType(OTHER_DOOR, ALTERNATE)),
                post(site.changes + "/" + id + "/preview"), post(site.changes + "/" + id + "/submit"),
                post(site.changes + "/" + id + "/discard"), post(site.changes + "/" + id + "/apply"), post(site.changes + "/" + id + "/restore"),
                get(version + "/summary"), get(version + "/elements"), get(version + "/elements/" + DOOR), get(version + "/prices"),
                get(version + "/diff").param("base", v1),
                put(version + "/prices").contentType("application/json").content("{\"prices\":[]}"),
                post(version + "/prices/copy").param("from", v1)))
            perform(request, stranger).andExpect(status().isNotFound());
        assertEquals("READY", site.change(id).get("status").asText());
        site.as(get(site.changes + "/" + UUID.randomUUID())).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").value("El cambio no existe."));
    }

    @Test void readsTheModelThroughTheEngine() throws Exception {
        var site = new Site();
        var version = site.base + "/versions/" + site.v1.get("id").asText();
        site.as(get(version + "/summary")).andExpect(status().isOk()).andExpect(jsonPath("$.schema").value("IFC2X3"));
        site.as(get(version + "/elements").param("class", "IfcDoor").param("limit", "50")).andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(0));
        site.as(get(version + "/elements").param("limit", "99")).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("SELECTOR_INVALID"));
        site.as(get(version + "/elements/" + DOOR)).andExpect(status().isOk()).andExpect(jsonPath("$.guid").value(DOOR));
        site.as(get(version + "/elements/corto")).andExpect(status().isBadRequest());
        var dwg = read(site.as(post(site.base + "/uploads").queryParam("name", "planta.dwg").contentType("application/octet-stream")
            .content(dwgBytes())).andExpect(status().isCreated())).get("id").asText();
        site.as(get(site.base + "/versions/" + dwg + "/summary")).andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.message").value("Selecciona una versión IFC."));
        // A DWG drawing takes model changes since «Revisión DXF real» (its revisions are DXF); an IFC operation is refused.
        var plan = read(site.as(post(site.changes).contentType("application/json").content(write(Map.of("baseVersion", dwg, "description", "Plano"))))
            .andExpect(status().isCreated()));
        org.junit.jupiter.api.Assertions.assertEquals("DWG", plan.get("format").asText());
        site.as(post(site.changes + "/" + plan.get("id").asText() + "/operations").contentType("application/json")
            .content(write(Map.of("op", "ifc.change_type", "element", DOOR, "type_id", ALTERNATE))))
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("OPERATION_FORMAT"));
        site.as(post(site.changes).contentType("application/json").content("{\"description\":\"Sin base\"}")).andExpect(status().isBadRequest());
    }

    // H7 · Comparar entre versiones ------------------------------------------------------------------------------------

    @Test void comparesTwoRevisionsOfTheSameFile() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();
        var v2 = site.upload(ORIGINAL + " /* v2 */", site.file).get("id").asText();
        var diff = site.base + "/versions/" + v2 + "/diff";
        // The engine receives the chosen revision as the base and the open one as the revision; its answer passes through.
        site.as(get(diff).param("base", v1)).andExpect(status().isOk())
            .andExpect(jsonPath("$.compared[0]").value(v1)).andExpect(jsonPath("$.compared[1]").value(v2))
            .andExpect(jsonPath("$.changed[0].guid").value(DOOR));
        site.as(get(site.base + "/versions/" + v1 + "/diff").param("base", v2)).andExpect(status().isOk())
            .andExpect(jsonPath("$.compared[0]").value(v2)).andExpect(jsonPath("$.compared[1]").value(v1));
        site.as(get(diff)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("BASE_REQUIRED"));
        site.as(get(diff).param("base", v2)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SAME_VERSION"));
        // Another file of the project, a DWG and a version of nobody: never sent to the engine.
        var other = read(site.as(post(site.base + "/uploads").queryParam("name", "Otro.ifc").contentType("application/octet-stream")
            .content(ORIGINAL)).andExpect(status().isCreated())).get("id").asText();
        site.as(get(diff).param("base", other)).andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.message").value("Solo se comparan revisiones del mismo archivo."));
        var dwg = read(site.as(post(site.base + "/uploads").queryParam("name", "planta.dwg").contentType("application/octet-stream")
            .content(dwgBytes())).andExpect(status().isCreated())).get("id").asText();
        site.as(get(diff).param("base", dwg)).andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.message").value("Selecciona una versión IFC."));
        site.as(get(diff).param("base", UUID.randomUUID().toString())).andExpect(status().isNotFound());
        // Comparing is the person's: an agent credential of the same project is refused.
        var session = tokens.readAccess(site.user.substring("Bearer ".length()));
        var agent = "Bearer " + tokens.agent(session, UUID.fromString(site.project), UUID.randomUUID(), Duration.ofMinutes(5));
        perform(get(diff).param("base", v1), agent).andExpect(status().isForbidden());
    }

    // J15 --------------------------------------------------------------------------------------------------------------

    @Test void migratedChangeIsADraft() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();
        var proposal = Map.of("version", v1, "element", DOOR, "typeId", ALTERNATE, "description", "Propuesta de la fachada");
        var facade = read(site.as(post(site.base + "/design-changes").contentType("application/json").content(write(proposal)))
            .andExpect(status().isCreated()));
        var legacy = db.queryForObject("select legacy_review from model_change where id=?", String.class, UUID.fromString(facade.get("id").asText()));
        var owner = db.queryForObject("select owner_id from project where id=?", UUID.class, UUID.fromString(site.project));

        // A row as V15 leaves a pending door_change: DRAFT, legacy review, recipe, no report and no preview.
        var migrated = UUID.randomUUID();
        var at = OffsetDateTime.now(ZoneOffset.UTC).minusDays(2);
        db.update("insert into model_change (id, project_id, file_id, base_version, format, status, origin, author_id, description, recipe,"
                + " legacy_review, created_at, updated_at) values (?, ?, ?, ?, 'IFC', 'DRAFT', 'PERSON', ?, ?, ?, ?, ?, ?)",
            migrated, UUID.fromString(site.project), UUID.fromString(site.file), UUID.fromString(v1), owner, "Cambio migrado",
            "{\"format\":\"obracota.recipe/1\",\"operations\":[{\"id\":\"op-1\",\"op\":\"ifc.change_type\",\"element\":\"" + DOOR
                + "\",\"type_id\":\"" + ALTERNATE + "\"}]}", legacy, at, at);

        var list = read(site.as(get(site.changes).param("status", "DRAFT")).andExpect(status().isOk()));
        assertEquals(1, list.size());
        var row = list.get(0);
        assertEquals(migrated.toString(), row.get("id").asText());
        assertEquals(ALTERNATE, row.at("/legacyReview/proposal/id").asText());
        assertEquals(1, row.at("/recipe/operations").size());
        assertTrue(row.get("report").isNull());
        assertFalse(row.get("reportCurrent").asBoolean());
        assertFalse(row.at("/preview/available").asBoolean());
        assertFalse(row.at("/actions/submit").asBoolean());
        assertEquals("Pendiente: previsualiza el cambio para enviarlo", row.at("/actions/reasons/submit").asText());
        assertTrue(row.at("/actions/preview").asBoolean());
        site.action(migrated.toString(), "apply").andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("Previsualiza el cambio para aprobarlo."));

        // The facade lists it with today's shape.
        var doors = read(site.as(get(site.base + "/design-changes")).andExpect(status().isOk()));
        assertEquals(2, doors.size());
        for (var door : doors)
            assertEquals(Set.of("id", "version", "description", "review", "applied", "restored", "picture"), names(door));

        // With the stub's ok preview it becomes submittable, like any draft.
        var previewed = read(site.action(migrated.toString(), "preview").andExpect(status().isOk()));
        assertTrue(previewed.get("reportCurrent").asBoolean());
        assertTrue(previewed.at("/actions/submit").asBoolean());
        site.action(migrated.toString(), "submit").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY"));
    }

    // J16 --------------------------------------------------------------------------------------------------------------

    @Test void staleBaseBlocksSiblings() throws Exception {
        var site = new Site();
        var v1 = site.v1.get("id").asText();
        var a = site.ready(v1, DOOR).get("id").asText();
        var b = site.ready(v1, OTHER_DOOR).get("id").asText();
        var bPreview = site.previewFile(b, site.previewId(b));
        assertTrue(Files.isRegularFile(bPreview));

        site.action(a, "apply").andExpect(status().isOk());
        var sibling = site.change(b);
        assertEquals("READY", sibling.get("status").asText());
        assertFalse(sibling.at("/actions/apply").asBoolean());
        assertEquals("Pendiente: la base ya no es la última revisión; descarta este cambio o propón uno nuevo sobre v2",
            sibling.at("/actions/reasons/apply").asText());
        assertFalse(sibling.at("/actions/preview").asBoolean());
        assertTrue(sibling.at("/actions/discard").asBoolean());
        assertFalse(sibling.at("/preview/available").asBoolean());
        assertTrue(sibling.get("report").isObject());
        assertFalse(Files.exists(bPreview));
        site.action(b, "apply").andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("Abre la revisión más reciente para proponer o revertir un cambio."));
        site.action(b, "preview").andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value("La base ya no es la última revisión (v2)."));
        assertTrue(site.events(b).contains("PREVIEW_CLEARED"));
        site.action(b, "discard").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DISCARDED"));

        // An APPLIED change with a later revision can no longer be restored.
        site.upload(ORIGINAL + "\n/* manual v3 */", site.file);
        var applied = site.change(a);
        assertFalse(applied.at("/actions/restore").asBoolean());
        assertEquals("Pendiente: hay una revisión posterior (v3); restaurar solo deshace la última", applied.at("/actions/reasons/restore").asText());
        site.action(a, "restore").andExpect(status().isConflict());
        assertEquals(3, site.revisions());
    }

    // J17 --------------------------------------------------------------------------------------------------------------

    @Test void concurrentEditsAndPreviews() throws Exception {
        var site = new Site();
        var id = site.create(site.v1.get("id").asText(), "Dos manos sobre el mismo borrador").get("id").asText();

        engine.checkPauseMillis = 300;
        var statuses = parallel(
            () -> site.addOperation(id, DOOR, ALTERNATE).andReturn().getResponse().getStatus(),
            () -> site.addOperation(id, OTHER_DOOR, ALTERNATE).andReturn().getResponse().getStatus());
        engine.checkPauseMillis = 0;
        assertTrue(statuses.stream().allMatch(code -> code == 201 || code == 409), statuses.toString());
        assertTrue(statuses.contains(201), statuses.toString());
        var operations = site.change(id).at("/recipe/operations");
        assertEquals(Collections.frequency(statuses, 201), operations.size());
        var opIds = new HashSet<String>();
        operations.forEach(operation -> opIds.add(operation.get("id").asText()));
        assertEquals(operations.size(), opIds.size());
        assertEquals(Collections.frequency(statuses, 201),
            Collections.frequency(site.events(id), "EDIT"));

        var previews = parallel(
            () -> site.action(id, "preview").andReturn().getResponse().getStatus(),
            () -> site.action(id, "preview").andReturn().getResponse().getStatus());
        assertTrue(previews.contains(200), previews.toString());
        var previewId = site.previewId(id);
        assertNotNull(previewId);
        var file = site.previewFile(id, previewId);
        assertTrue(Files.isRegularFile(file));
        assertEquals(db.queryForObject("select preview_sha256 from model_change where id=?", String.class, UUID.fromString(id)),
            sha256Hex(Files.readAllBytes(file)));
        site.action(id, "submit").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY"));
    }

    // J3 ---------------------------------------------------------------------------------------------------------------

    @Test void agentCredentialCannotPublish() throws Exception {
        var site = new Site();
        var project = UUID.fromString(site.project);
        var v1 = site.v1.get("id").asText();
        var session = tokens.readAccess(site.user.substring("Bearer ".length()));
        var run = UUID.randomUUID();
        var agent = "Bearer " + tokens.agent(session, project, run, Duration.ofMinutes(5));

        // The person's READY change and a DRAFT of hers with one operation.
        var ready = site.ready(v1, DOOR).get("id").asText();
        var draft = site.create(v1, "Borrador de la persona").get("id").asText();
        site.addOperation(draft, OTHER_DOOR, ALTERNATE).andExpect(status().isCreated());

        // Publishing, restoring, pricing and anything outside the agent's routes: 403 with the JSON body, nothing changes.
        var forbidden = List.of(
            post(site.changes + "/" + ready + "/apply"), post(site.changes + "/" + ready + "/restore"),
            post(site.base + "/design-changes/" + ready + "/restore"),
            post(site.base + "/design-changes").contentType("application/json")
                .content(write(Map.of("version", v1, "element", DOOR, "typeId", ALTERNATE, "description", "Puerta del agente"))),
            put(site.base + "/versions/" + v1 + "/prices").contentType("application/json")
                .content("{\"prices\":[{\"key\":\"type:" + ALTERNATE + "\",\"unit\":\"UNIT\",\"amount\":1,\"source\":\"x\",\"date\":\"2026-11-20\"}]}"),
            post(site.base + "/versions/" + v1 + "/prices/copy").queryParam("from", v1),
            put(site.base + "/design-changes/pricing").queryParam("version", v1).contentType("application/json").content("{\"prices\":[]}"),
            post("/api/projects").contentType("application/json").content("{\"name\":\"Proyecto del agente\"}"),
            get("/api/projects"), get(site.base + "/design-changes"), get(site.base + "/versions/" + v1 + "/original"));
        for (var request : forbidden)
            perform(request, agent).andExpect(status().isForbidden()).andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.message").value("Publicar, restaurar y fijar precios exigen la sesión de la propietaria."));
        assertEquals("READY", site.change(ready).get("status").asText());
        assertEquals(1, site.revisions());
        assertEquals(0, db.queryForObject("select count(*) from unit_price where version_id=?", Integer.class, UUID.fromString(v1)));

        // What the agent may do inside its project: read, and create, edit, preview and submit its own drafts.
        perform(get(site.base + "/files"), agent).andExpect(status().isOk());
        perform(get(site.base + "/files/" + site.file + "/versions"), agent).andExpect(status().isOk());
        perform(get(site.base + "/versions/" + v1), agent).andExpect(status().isOk());
        perform(get(site.base + "/versions/" + v1 + "/summary"), agent).andExpect(status().isOk());
        perform(get(site.base + "/versions/" + v1 + "/elements"), agent).andExpect(status().isOk());
        perform(get(site.base + "/versions/" + v1 + "/elements/" + DOOR), agent).andExpect(status().isOk());
        perform(get(site.base + "/versions/" + v1 + "/prices"), agent).andExpect(status().isOk());
        perform(get(site.changes + "/" + ready), agent).andExpect(status().isOk())
            .andExpect(jsonPath("$.actions.apply").value(false));
        clock.advance(Duration.ofSeconds(1));
        var own = read(perform(post(site.changes).contentType("application/json")
            .content(write(Map.of("baseVersion", v1, "description", "Propuesta del agente"))), agent).andExpect(status().isCreated()));
        var mine = own.get("id").asText();
        assertEquals("AGENT", own.get("origin").asText());
        assertEquals(run.toString(), own.get("agentRun").asText());
        perform(post(site.changes + "/" + mine + "/operations").contentType("application/json").content(changeType(DOOR, ALTERNATE)), agent)
            .andExpect(status().isCreated());
        perform(post(site.changes + "/" + mine + "/preview"), agent).andExpect(status().isOk()).andExpect(jsonPath("$.report.ok").value(true));
        perform(post(site.changes + "/" + mine + "/submit"), agent).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("READY")).andExpect(jsonPath("$.origin").value("AGENT"))
            .andExpect(jsonPath("$.actions.apply").value(false));
        perform(post(site.changes + "/" + mine + "/apply"), agent).andExpect(status().isForbidden());
        assertEquals("READY", site.change(mine).get("status").asText());

        // Someone else's change: the person's, or an agent's of another run.
        var otherRun = "Bearer " + tokens.agent(session, project, UUID.randomUUID(), Duration.ofMinutes(5));
        clock.advance(Duration.ofSeconds(1));
        var theirs = read(perform(post(site.changes).contentType("application/json")
            .content(write(Map.of("baseVersion", v1, "description", "Otra ejecución"))), otherRun).andExpect(status().isCreated())).get("id").asText();
        perform(post(site.changes + "/" + theirs + "/operations").contentType("application/json").content(changeType(OTHER_DOOR, ALTERNATE)), otherRun)
            .andExpect(status().isCreated());
        for (var change : List.of(draft, theirs)) {
            perform(put(site.changes + "/" + change + "/operations/op-1").contentType("application/json").content(changeType(OTHER_DOOR, CURRENT)), agent)
                .andExpect(status().isForbidden());
            perform(delete(site.changes + "/" + change + "/operations/op-1"), agent).andExpect(status().isForbidden());
            perform(post(site.changes + "/" + change + "/discard"), agent).andExpect(status().isForbidden());
            assertEquals(1, site.change(change).at("/recipe/operations").size());
        }

        // Discarding its own change records the agent.
        perform(post(site.changes + "/" + mine + "/discard"), agent).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DISCARDED")).andExpect(jsonPath("$.discardedBy.kind").value("AGENT"))
            .andExpect(jsonPath("$.discardedBy.agentRun").value(run.toString()));

        // A credential of another project of the same person reaches nothing here.
        var other = UUID.fromString(read(site.as(post("/api/projects").contentType("application/json").content("{\"name\":\"Otra obra\"}"))
            .andExpect(status().isCreated())).get("id").asText());
        var elsewhere = "Bearer " + tokens.agent(session, other, run, Duration.ofMinutes(5));
        perform(get(site.changes), elsewhere).andExpect(status().isForbidden()).andExpect(jsonPath("$.message").exists());
        perform(post(site.changes).contentType("application/json")
            .content(write(Map.of("baseVersion", v1, "description", "Fuera de su proyecto"))), elsewhere).andExpect(status().isForbidden());
        perform(get(site.base + "/versions/" + v1 + "/summary"), elsewhere).andExpect(status().isForbidden());
        perform(get("/api/projects/" + other + "/model-changes"), elsewhere).andExpect(status().isOk());
        perform(get("/api/projects/no-es-un-uuid/model-changes"), elsewhere).andExpect(status().isForbidden());

        // The life of an agent credential is bounded: the issuer refuses more than 15 minutes, the reader too.
        assertThrows(IllegalArgumentException.class, () -> tokens.agent(session, project, run, Duration.ofMinutes(16)));
        var issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        var forged = Jwts.builder().issuer("obracota").subject(session.userId().toString()).id(UUID.randomUUID().toString())
            .claim("kind", "agent").claim("sid", session.sessionId().toString()).claim("prj", site.project).claim("run", run.toString())
            .issuedAt(Date.from(issued)).expiration(Date.from(issued.plus(Duration.ofMinutes(16))))
            .signWith(Keys.hmacShaKeyFor(Base64.getDecoder().decode(secret))).compact();
        perform(get(site.changes), "Bearer " + forged).andExpect(status().isUnauthorized());
        var withoutRun = Jwts.builder().issuer("obracota").subject(session.userId().toString()).id(UUID.randomUUID().toString())
            .claim("kind", "agent").claim("sid", session.sessionId().toString()).claim("prj", site.project)
            .issuedAt(Date.from(issued)).expiration(Date.from(issued.plus(Duration.ofMinutes(5))))
            .signWith(Keys.hmacShaKeyFor(Base64.getDecoder().decode(secret))).compact();
        perform(get(site.changes), "Bearer " + withoutRun).andExpect(status().isUnauthorized());
        perform(get(site.changes), null).andExpect(status().isUnauthorized());

        // The person is unaffected, and the use cases hold even without HTTP.
        site.action(ready, "apply").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPLIED"));
        var actor = Actor.agent(session.userId(), project, run);
        var readyId = UUID.fromString(ready);
        assertThrows(ForbiddenApplicationException.class, () -> publish.apply(actor, project, readyId));
        assertThrows(ForbiddenApplicationException.class, () -> publish.restore(actor, project, readyId));
        assertThrows(ForbiddenApplicationException.class, () -> pricing.replace(actor, project, UUID.fromString(v1), null, List.of()));
        assertThrows(ForbiddenApplicationException.class, () -> pricing.copy(actor, project, UUID.fromString(v1), UUID.fromString(v1)));
        assertThrows(ForbiddenApplicationException.class, () -> facade.restore(project, readyId, actor));
        assertThrows(ForbiddenApplicationException.class, () -> facade.savePricing(project, actor, UUID.fromString(v1),
            new DesignChangeController.Pricing(null, List.of())));
        assertEquals("APPLIED", site.change(ready).get("status").asText());
    }

    // Helpers ----------------------------------------------------------------------------------------------------------

    List<Integer> parallel(Callable<Integer> first, Callable<Integer> second) throws Exception {
        var barrier = new CyclicBarrier(2);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var one = pool.submit(() -> { barrier.await(); return first.call(); });
            var two = pool.submit(() -> { barrier.await(); return second.call(); });
            return List.of(one.get(30, TimeUnit.SECONDS), two.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    String register() throws Exception {
        var result = read(perform(post("/api/auth/register").header("X-ObraCota-Client", "web").contentType("application/json")
            .content(write(Map.of("email", UUID.randomUUID() + "@example.test", "password", "UnaClaveDePrueba!"))), null)
            .andExpect(status().isCreated()));
        return "Bearer " + result.get("accessToken").asText();
    }

    ResultActions perform(MockHttpServletRequestBuilder request, String token) {
        try {
            return mvc.perform(token == null ? request : request.header("Authorization", token));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    JsonNode read(ResultActions actions) {
        try {
            return json.readTree(actions.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String changeType(String element, String type) {
        return "{\"op\":\"ifc.change_type\",\"element\":\"" + element + "\",\"type_id\":\"" + type + "\"}";
    }

    static Set<String> ids(JsonNode list) {
        var ids = new HashSet<String>();
        list.forEach(node -> ids.add(node.get("id").asText()));
        return ids;
    }

    static Set<String> names(JsonNode node) {
        var names = new HashSet<String>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    /** The smallest body the DWG upload accepts: the {@code AC1032} version signature. */
    static byte[] dwgBytes() { return "AC1032\0\0\0\0\0\0".getBytes(StandardCharsets.US_ASCII); }
}
