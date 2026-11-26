package com.obracota.infrastructure.modelchange;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.agenttools.DesignAgentTools;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.domain.agent.port.service.AgentModelPort;
import com.obracota.domain.modelchange.model.recipe.*;
import com.obracota.infrastructure.agent.adapters.out.ai.ScriptedAgentModelAdapter;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import com.obracota.infrastructure.modelversion.adapters.out.storage.VolumeStorage;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * «Revisión DXF real»: model changes and the design agent on a DWG drawing, with the engine stubbed and the scripted
 * agent. A note on a marked entity becomes one {@code dwg.*} operation in a READY draft; approving it publishes revision
 * 2 of the same file as {@code <original>-r2.dxf} (format DXF), and a second change works on that DXF. The recipe of a
 * drawing never mixes {@code ifc.*} operations and the notes carry DWG handles, not GlobalIds.
 */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test") @Import(ModelChangeStubs.Beans.class)
class DrawingRevisionFlowTest {
    @TempDir static Path root;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) { r.add("models.directory", () -> root.toString()); }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired DesignAgentTools tools;
    @Autowired ModelChangeStubs.Engine engine;

    final class Site {
        final String token = register();
        final String project = read(perform(post("/api/projects").contentType("application/json").content("{\"name\":\"Obra DWG\"}"))
            .andExpect(status().isCreated())).get("id").asText();
        final String version = read(perform(post("/api/projects/" + project + "/uploads").queryParam("name", "Planta tipo.dwg")
            .contentType("application/octet-stream").content("AC1032\0\0\0\0\0".getBytes(StandardCharsets.ISO_8859_1)))
            .andExpect(status().isCreated())).get("id").asText();

        Site() throws Exception {}

        ResultActions perform(MockHttpServletRequestBuilder request) {
            try {
                return mvc.perform(request.header("Authorization", token));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }

        JsonNode agent(String version, String handle, String note) throws Exception {
            var body = Map.of("version", version, "notes", List.of(Map.of("globalId", handle, "name", "MTEXT · " + handle, "text", note)));
            return read(perform(post("/api/projects/" + project + "/agent-runs").contentType("application/json")
                .content(json.writeValueAsString(body))).andExpect(status().isOk()));
        }

        JsonNode change(String id) throws Exception { return read(perform(get("/api/projects/" + project + "/model-changes/" + id)).andExpect(status().isOk())); }
    }

    @Test void aNoteOnATextBecomesADxfRevisionAndASecondChangeWorksOnIt() throws Exception {
        engine.reset();
        var site = new Site();
        var run = site.agent(site.version, "3465", "Cambiar texto a REVISADO OBRA");
        assertEquals("READY", run.get("status").asText(), run.toString());
        assertEquals(List.of("get_dwg_entity:OK", "draft_dwg_change:OK", "preview_change:OK", "submit_change:OK"), steps(run));

        var change = site.change(run.get("change").asText());
        assertEquals("DWG", change.get("format").asText());
        assertEquals("AGENT", change.get("origin").asText());
        var operation = change.get("recipe").get("operations").get(0);
        assertEquals("dwg.set_text", operation.get("op").asText());
        assertEquals("3465", operation.get("element").asText());
        assertEquals("REVISADO OBRA", operation.get("text").asText());

        // Only the owner publishes: the approved revision is the DXF of the preview, a new version of the same file.
        site.perform(post("/api/projects/" + site.project + "/model-changes/" + change.get("id").asText() + "/apply")).andExpect(status().isOk());
        var revision = db.queryForMap("select v.id, v.name, v.format, v.revision from model_version v where v.file_id=(select file_id from "
            + "model_version where id=?) order by v.revision desc limit 1", UUID.fromString(site.version));
        assertEquals("Planta tipo-r2.dxf", revision.get("name"));
        assertEquals("DXF", revision.get("format"));
        assertEquals(2, revision.get("revision"));

        var dxf = revision.get("id").toString();
        var moved = site.agent(dxf, "C27", "Mover 500 mm a la derecha.");
        assertEquals("READY", moved.get("status").asText(), moved.toString());
        var second = site.change(moved.get("change").asText());
        assertEquals("DXF", second.get("format").asText());
        var move = second.get("recipe").get("operations").get(0);
        assertEquals("dwg.move", move.get("op").asText());
        assertEquals(0, new BigDecimal("500").compareTo(move.get("dx").decimalValue()));
        assertEquals(0, move.get("dy").decimalValue().signum());
        assertEquals("mm", move.get("unit").asText());
        site.perform(post("/api/projects/" + site.project + "/model-changes/" + second.get("id").asText() + "/apply")).andExpect(status().isOk());
        assertEquals("Planta tipo-r3.dxf", db.queryForObject("select name from model_version where file_id=(select file_id from model_version "
            + "where id=?) and revision=3", String.class, UUID.fromString(site.version)));
    }

    @Test void aNoteTheTestAgentDoesNotUnderstandLeavesNoChange() throws Exception {
        engine.reset();
        var site = new Site();
        var run = site.agent(site.version, "3465", "Hazlo más bonito");
        assertEquals("NO_CHANGE", run.get("status").asText());
        assertEquals(0, db.queryForObject("select count(*) from model_change where base_version in (select v.id from model_version v join model_file f on f.id=v.file_id where f.project_id=?)", Integer.class, UUID.fromString(site.project)));
    }

    @Test void aDrawingTakesHandlesAndOnlyDrawingOperations() throws Exception {
        engine.reset();
        var site = new Site();
        var body = Map.of("version", site.version, "notes", List.of(Map.of("globalId", ModelChangeStubs.DOOR, "name", "Puerta", "text", "Cambiar texto a X")));
        site.perform(post("/api/projects/" + site.project + "/agent-runs").contentType("application/json").content(json.writeValueAsString(body)))
            .andExpect(status().isBadRequest());

        var created = read(site.perform(post("/api/projects/" + site.project + "/model-changes").contentType("application/json")
            .content(json.writeValueAsString(Map.of("baseVersion", site.version, "description", "Prueba de plano")))).andExpect(status().isCreated()));
        var path = "/api/projects/" + site.project + "/model-changes/" + created.get("id").asText() + "/operations";
        site.perform(post(path).contentType("application/json").content(json.writeValueAsString(Map.of("op", "ifc.change_type",
            "element", ModelChangeStubs.DOOR, "type_id", ModelChangeStubs.ALTERNATE)))).andExpect(status().isUnprocessableEntity());
        var added = read(site.perform(post(path).contentType("application/json").content(json.writeValueAsString(Map.of("op", "dwg.set_color",
            "element", "C27", "color", 1)))).andExpect(status().isCreated()));
        assertEquals("dwg.set_color", added.get("recipe").get("operations").get(0).get("op").asText());
    }

    @Test void theDrawingCatalogIsSmallAndRefusesUnmarkedEntities() {
        var drawingTools = new ArrayList<String>();
        var session = new DesignAgentTools.Session(com.obracota.domain.security.model.Actor.agent(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID()),
            UUID.randomUUID(), UUID.randomUUID(), List.of("3465"), "Prueba", true);
        tools.declarations(session).forEach(tool -> drawingTools.add(tool.name()));
        assertEquals(List.of("get_dwg_entity", "draft_dwg_change", "preview_change", "submit_change", "discard_change"), drawingTools);
        assertFalse(tools.declared(session, "draft_set_property"));
        var refused = assertThrows(DesignAgentTools.Rejected.class, () -> tools.execute(session, "draft_dwg_change",
            Map.of("handle", "C27", "action", "set_text", "text", "X")));
        assertEquals("NOT_MARKED", refused.code());
    }

    @Test void theTestAgentReadsTypicalSpanishNotes() {
        assertEquals(Map.of("action", "set_text", "text", "REVISADO OBRA"), change("Cambiar texto a REVISADO OBRA"));
        assertEquals(Map.of("action", "set_text", "text", "PLANTA 2"), change("cambiar el texto por «PLANTA 2»."));
        assertEquals(Map.of("action", "set_text", "text", "COCINA"), change("Reemplazar texto por COCINA"));
        assertEquals(Map.of("action", "set_layer", "layer", "A-MURO-DEMO"), change("Cambiar capa a A-MURO-DEMO"));
        assertEquals(Map.of("action", "set_color", "color", 1), change("Cambiar color a rojo"));
        assertEquals(Map.of("action", "set_color", "color", 30), change("Cambiar color a 30"));
        assertEquals(Map.of("action", "add_note", "text", "Verificar en obra"), change("Agregar nota: Verificar en obra"));
        var right = change("Mover 500 mm a la derecha");
        assertEquals("move", right.get("action"));
        assertEquals(0, new BigDecimal("500").compareTo((BigDecimal) right.get("dx")));
        assertEquals("mm", right.get("unit"));
        var down = change("Mover 1,5 m hacia abajo");
        assertEquals(0, new BigDecimal("-1.5").compareTo((BigDecimal) down.get("dy")));
        assertEquals("m", down.get("unit"));
        assertNull(change("Hazlo más bonito"));
        // The scripted model answers the drawing's script when the catalog is the drawing's.
        var model = ScriptedAgentModelAdapter.defaultScript();
        var prompt = com.obracota.application.agent.RunDesignAgent.prompt(List.of(new com.obracota.application.agent.RunDesignAgent.Note("3465", "MTEXT", "Cambiar texto a X")), true);
        var request = new AgentModelPort.Request("fake", "s", List.of(AgentModelPort.Message.user(List.of(new AgentModelPort.Text(prompt)))),
            List.of(new AgentModelPort.Tool("get_dwg_entity", "d", null)));
        assertEquals("get_dwg_entity", model.next(request).calls().getFirst().name());
    }

    @Test void drawingRecipesRoundTripAndNeverMixWithIfc() {
        var codec = new JacksonRecipeCodec();
        var recipe = new Recipe(Recipe.FORMAT, List.of(new DwgSetText("op-1", "3465", "REVISADO OBRA"),
            new DwgMove("op-2", "C27", new BigDecimal("500.0"), BigDecimal.ZERO, "mm"), new DwgSetLayer("op-3", "C27", "A-NUEVA"),
            new DwgSetColor("op-4", "9EA", 3), new DwgAddNote("op-5", "9EA", "Verificar")));
        assertTrue(recipe.drawing());
        assertEquals(recipe, codec.recipe(codec.canonical(recipe)));
        assertThrows(IllegalArgumentException.class, () -> new Recipe(Recipe.FORMAT, List.of(new DwgSetText("op-1", "3465", "X"),
            new ChangeType("op-2", ModelChangeStubs.DOOR, ModelChangeStubs.ALTERNATE))));
        assertThrows(IllegalArgumentException.class, () -> new DwgSetText("op-1", "3465", "dos\nlíneas"));
        assertThrows(IllegalArgumentException.class, () -> new DwgSetText("op-1", "zz", "X"));
        assertThrows(IllegalArgumentException.class, () -> new DwgSetColor("op-1", "1A", 257));
        assertThrows(IllegalArgumentException.class, () -> new DwgMove("op-1", "1A", BigDecimal.ZERO, BigDecimal.ZERO, "mm"));
        assertThrows(IllegalArgumentException.class, () -> new DwgMove("op-1", "1A", BigDecimal.ONE, BigDecimal.ZERO, "yd"));
        assertThrows(IllegalArgumentException.class, () -> new DwgSetLayer("op-1", "1A", "a/b"));
    }

    @Test void revisionNamesAndDxfHeaders() {
        assertEquals("plano-r2.dxf", PublishModelChange.drawingRevisionName("plano.dwg", 2));
        assertEquals("plano-r3.dxf", PublishModelChange.drawingRevisionName("plano-r2.dxf", 3));
        assertEquals("plano.v1-r4.dxf", PublishModelChange.drawingRevisionName("plano.v1.dwg", 4));
        assertTrue(VolumeStorage.compatible("DXF", "  0\nSECTION\n  2\nHEADER\n".getBytes(StandardCharsets.US_ASCII)));
        assertTrue(VolumeStorage.compatible("DXF", "999\nezdxf\n  0\r\nSECTION\r\n".getBytes(StandardCharsets.US_ASCII)));
        assertTrue(VolumeStorage.compatible("DXF", "AutoCAD Binary DXF\r\n\u001a\0".getBytes(StandardCharsets.ISO_8859_1)));
        assertFalse(VolumeStorage.compatible("DXF", "AC1032".getBytes(StandardCharsets.US_ASCII)));
        assertFalse(VolumeStorage.compatible("DXF", "ISO-10303-21;".getBytes(StandardCharsets.US_ASCII)));
    }

    private static Map<String, Object> change(String note) {
        return ScriptedAgentModelAdapter.drawingChange("Notas de la propietaria (instrucciones):\n1. " + note + " [marca sobre la entidad DWG 3465]\n");
    }

    private static List<String> steps(JsonNode run) {
        var out = new ArrayList<String>();
        run.get("steps").forEach(step -> out.add(step.get("tool").asText() + ":" + step.get("status").asText()));
        return out;
    }

    private JsonNode read(ResultActions result) {
        try {
            return json.readTree(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String register() {
        try {
            var result = mvc.perform(post("/api/auth/register").header("X-ObraCota-Client", "web").contentType("application/json")
                .content("{\"email\":\"" + UUID.randomUUID() + "@example.test\",\"password\":\"UnaClaveDePrueba!\"}")).andExpect(status().isCreated());
            return "Bearer " + read(result).get("accessToken").asText();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
