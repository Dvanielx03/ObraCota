package com.obracota.infrastructure.designchange;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.ForbiddenApplicationException;
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

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static com.obracota.infrastructure.modelchange.ModelChangeStubs.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** J11: the door routes keep their paths, bodies and answers as a facade over {@code model_change}. */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test") @Import(ModelChangeStubs.Beans.class)
class DesignChangeFacadeTest {
    static final byte[] PNG = Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
    static final String ORIGINAL = "ISO-10303-21;";

    @TempDir static Path root;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) { r.add("models.directory", () -> root.toString()); }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired DesignChangeController facade;
    @Autowired MutableClock clock;

    String register() throws Exception {
        var result = mvc.perform(post("/api/auth/register").header("X-ObraCota-Client", "web").contentType("application/json")
            .content(json.writeValueAsBytes(Map.of("email", UUID.randomUUID() + "@example.test", "password", "UnaClaveDePrueba!"))))
            .andExpect(status().isCreated()).andReturn();
        return "Bearer " + json.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
    }

    JsonNode read(org.springframework.test.web.servlet.ResultActions actions) throws Exception {
        return json.readTree(actions.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    @Test void theDoorRoutesKeepTheirShapeOverModelChange() throws Exception {
        var user = register();
        var project = read(mvc.perform(post("/api/projects").header("Authorization", user).contentType("application/json")
            .content("{\"name\":\"Fachada de puerta\"}")).andExpect(status().isCreated())).get("id").asText();
        var base = "/api/projects/" + project;
        var v1 = read(mvc.perform(post(base + "/uploads").queryParam("name", "Duplex.ifc").header("Authorization", user)
            .contentType("application/octet-stream").content(ORIGINAL)).andExpect(status().isCreated()));
        var version = v1.get("id").asText();
        var changes = base + "/design-changes";

        // Preserve the door rule independently from the removed cost feature.
        mvc.perform(get(changes + "/door").param("version", version).param("element", DOOR).header("Authorization", user))
            .andExpect(status().isOk()).andExpect(jsonPath("$.typeId").value(CURRENT)).andExpect(jsonPath("$.width").value(0.762));
        mvc.perform(put(changes + "/minimum-width").header("Authorization", user).contentType("application/json")
            .content("{\"minimum\":0.8}")).andExpect(status().isNoContent());
        mvc.perform(get(changes + "/review").param("version", version).param("element", DOOR).param("typeId", ALTERNATE)
            .header("Authorization", user)).andExpect(status().isOk()).andExpect(jsonPath("$.findings[?(@.rule=='MINIMUM_NOMINAL_WIDTH')].status").value("WARNING"));
        mvc.perform(get(changes + "/review").param("version", version).param("element", DOOR).param("typeId", "4klOFZffH6WQFlV10uM1wH")
            .header("Authorization", user)).andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.message").value("El tipo no está disponible en este IFC."));

        // POST: an ok preview leaves the change READY, with the review of today and the verified preview stored.
        var proposal = Map.of("version", version, "element", DOOR, "typeId", ALTERNATE,
            "description", "Probar una puerta alternativa con el mismo hueco", "picture", Base64.getEncoder().encodeToString(PNG));
        var ready = read(mvc.perform(post(changes).header("Authorization", user).contentType("application/json")
            .content(json.writeValueAsBytes(proposal))).andExpect(status().isCreated()));
        assertEquals(Set.of("id", "version", "description", "review", "applied", "restored", "picture"), names(ready));
        assertEquals(version, ready.get("version").asText());
        assertTrue(ready.get("picture").asBoolean());
        assertTrue(ready.get("applied").isNull());
        assertEquals(ALTERNATE, ready.at("/review/proposal/id").asText());
        assertEquals(DOOR, ready.at("/review/door/element").asText());
        assertTrue(ready.at("/review/findings").isArray());
        var readyId = UUID.fromString(ready.get("id").asText());
        assertEquals("READY", db.queryForObject("select status from model_change where id=?", String.class, readyId));
        assertEquals("PERSON", db.queryForObject("select origin from model_change where id=?", String.class, readyId));
        var previewId = db.queryForObject("select preview_id from model_change where id=?", UUID.class, readyId);
        assertTrue(Files.isRegularFile(root.resolve(".previews").resolve(project).resolve(readyId.toString()).resolve(previewId + ".ifc")));
        assertEquals(List.of("CREATE", "EDIT", "PREVIEW", "SUBMIT"),
            db.queryForList("select action from model_change_event where change_id=? order by id", String.class, readyId));

        // POST with an incompatible type: still 201, kept as a DRAFT with its failed report.
        clock.advance(java.time.Duration.ofSeconds(1));
        var incompatible = new HashMap<>(proposal);
        incompatible.put("typeId", INCOMPATIBLE);
        incompatible.put("picture", null);
        var draft = read(mvc.perform(post(changes).header("Authorization", user).contentType("application/json")
            .content(json.writeValueAsBytes(incompatible))).andExpect(status().isCreated()));
        var draftId = UUID.fromString(draft.get("id").asText());
        assertFalse(draft.get("picture").asBoolean());
        assertEquals("DRAFT", db.queryForObject("select status from model_change where id=?", String.class, draftId));
        assertEquals(false, json.readTree(db.queryForObject("select report from model_change where id=?", String.class, draftId)).get("ok").asBoolean());
        assertNull(db.queryForObject("select preview_id from model_change where id=?", UUID.class, draftId));
        // R4: the facade no longer publishes; a door change is approved through /model-changes/{id}/apply.
        mvc.perform(post(changes + "/" + draftId + "/apply").header("Authorization", user)).andExpect(status().is4xxClientError());
        mvc.perform(post(base + "/model-changes/" + draftId + "/apply").header("Authorization", user))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Previsualiza el cambio para aprobarlo."));

        // GET keeps today's list shape, most recent first; the picture route is unchanged.
        var list = read(mvc.perform(get(changes).header("Authorization", user)).andExpect(status().isOk()));
        assertEquals(2, list.size());
        assertEquals(draftId.toString(), list.get(0).get("id").asText());
        assertEquals(readyId.toString(), list.get(1).get("id").asText());
        for (var row : list) assertEquals(Set.of("id", "version", "description", "review", "applied", "restored", "picture"), names(row));
        mvc.perform(get(changes + "/" + readyId + "/picture").header("Authorization", user))
            .andExpect(status().isOk()).andExpect(content().contentType("image/png")).andExpect(content().bytes(PNG));
        mvc.perform(get(changes).header("Authorization", register())).andExpect(status().isNotFound());

        // The facade hands its resolved actor to the use cases: an agent cannot publish through it.
        var userId = db.queryForObject("select owner_id from project where id=?", UUID.class, UUID.fromString(project));
        var agent = Actor.agent(userId, UUID.fromString(project), UUID.randomUUID());
        assertThrows(ForbiddenApplicationException.class, () -> facade.restore(UUID.fromString(project), readyId, agent));
        assertThrows(ForbiddenApplicationException.class, () -> facade.saveMinimum(UUID.fromString(project), agent, new DesignChangeController.MinimumWidth(BigDecimal.ONE)));

        // Apply creates revision 2 with the preview's bytes and is idempotent.
        mvc.perform(post(base + "/model-changes/" + readyId + "/apply").header("Authorization", user)).andExpect(status().isOk());
        var v2 = applied(read(mvc.perform(get(changes).header("Authorization", user)).andExpect(status().isOk())), readyId);
        var revision = read(mvc.perform(get(base + "/versions/" + v2).header("Authorization", user)).andExpect(status().isOk()));
        assertEquals(2, revision.get("revision").asInt());
        var stored = db.queryForObject("select preview_sha256 from model_change where id=?", String.class, readyId);
        assertNull(stored);
        assertNotEquals(v1.get("sha256").asText(), revision.get("sha256").asText());
        assertFalse(Files.exists(root.resolve(".previews").resolve(project).resolve(readyId.toString()).resolve(previewId + ".ifc")));
        mvc.perform(post(base + "/model-changes/" + readyId + "/apply").header("Authorization", user)).andExpect(status().isOk());
        assertEquals(v2, applied(read(mvc.perform(get(changes).header("Authorization", user))), readyId));

        // Proposing on a base that is no longer the latest is a 409 now (it used to fail on apply).
        mvc.perform(post(changes).header("Authorization", user).contentType("application/json").content(json.writeValueAsBytes(proposal)))
            .andExpect(status().isConflict());

        // Restore creates revision 3 with the bytes of the base.
        var restored = read(mvc.perform(post(changes + "/" + readyId + "/restore").header("Authorization", user)).andExpect(status().isOk()));
        var v3 = read(mvc.perform(get(base + "/versions/" + restored.get("restored").asText()).header("Authorization", user)));
        assertEquals(3, v3.get("revision").asInt());
        assertEquals(v1.get("sha256").asText(), v3.get("sha256").asText());
        assertEquals(sha256Hex(ORIGINAL.getBytes(StandardCharsets.UTF_8)), v3.get("sha256").asText());
        mvc.perform(post(changes + "/" + readyId + "/restore").header("Authorization", user))
            .andExpect(status().isOk()).andExpect(jsonPath("$.restored").value(restored.get("restored").asText()));
        mvc.perform(post(changes + "/" + draftId + "/restore").header("Authorization", user))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Todavía no se aplicó el cambio."));
        assertEquals(List.of("CREATE", "EDIT", "PREVIEW", "SUBMIT", "APPLY", "RESTORE"),
            db.queryForList("select action from model_change_event where change_id=? order by id", String.class, readyId));
    }

    /** The {@code applied} version of one row of the facade's list. */
    static String applied(JsonNode list, UUID id) {
        for (var row : list) if (row.get("id").asText().equals(id.toString())) return row.get("applied").asText();
        throw new AssertionError("Missing change " + id);
    }

    static Set<String> names(JsonNode node) {
        var names = new HashSet<String>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
