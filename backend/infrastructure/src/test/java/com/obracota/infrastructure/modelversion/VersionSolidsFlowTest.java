package com.obracota.infrastructure.modelversion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.EngineUnavailableException;
import com.obracota.domain.modelversion.port.SolidMeshPort;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * {@code GET /api/projects/{project}/versions/{version}/solids} with the engine stubbed: ownership, format, the
 * reference the engine receives, the mesh passed through with its ETag, 304 on revalidation and the engine's errors.
 */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test") @Import(VersionSolidsFlowTest.Stub.class)
class VersionSolidsFlowTest {
    static final byte[] MESH = {0x1f, (byte) 0x8b, 8, 0, 9, 8, 7, 6, 5};
    static final String TESSELLATOR = "acis-occt-1";

    @TempDir static Path volume;
    @DynamicPropertySource static void storage(DynamicPropertyRegistry config) { config.add("models.directory", () -> volume.toString()); }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired Engine engine;

    /** Records each call and answers {@link #MESH}, or throws {@link #failure} when set. */
    static final class Engine implements SolidMeshPort {
        final List<List<Object>> calls = new CopyOnWriteArrayList<>();
        final List<AtomicBoolean> closed = new CopyOnWriteArrayList<>();
        final AtomicReference<RuntimeException> failure = new AtomicReference<>();
        final List<String> revalidations = new CopyOnWriteArrayList<>();
        final AtomicBoolean unchanged = new AtomicBoolean();

        @Override public Mesh solids(UUID project, UUID version, String sha256, String ifNoneMatch) {
            calls.add(List.of(project, version, sha256));
            revalidations.add(Objects.requireNonNullElse(ifNoneMatch, ""));
            if (failure.get() != null) throw failure.get();
            if (unchanged.get() && ifNoneMatch != null) return Mesh.unchanged(sha256, TESSELLATOR, "obracota.dwg-solids/1");
            var flag = new AtomicBoolean();
            closed.add(flag);
            var content = new FilterInputStream(new ByteArrayInputStream(MESH)) {
                @Override public void close() throws IOException { flag.set(true); super.close(); }
            };
            return new Mesh(content, MESH.length, sha256, TESSELLATOR, "obracota.dwg-solids/1", "application/gzip");
        }
    }

    @TestConfiguration
    static class Stub {
        @Bean @Primary Engine stubSolidMesh() { return new Engine(); }
    }

    @AfterEach void reset() {
        engine.calls.clear();
        engine.closed.clear();
        engine.failure.set(null);
        engine.revalidations.clear();
        engine.unchanged.set(false);
    }

    String token() throws Exception {
        var response = mvc.perform(post("/api/auth/register").header("X-ObraCota-Client", "web").contentType("application/json")
                .content(json.writeValueAsBytes(Map.of("email", UUID.randomUUID() + "@example.test", "password", "UnaClaveDePrueba!"))))
            .andExpect(status().isCreated()).andReturn().getResponse();
        return "Bearer " + json.readTree(response.getContentAsString()).get("accessToken").asText();
    }

    String project(String owner) throws Exception {
        var result = mvc.perform(post("/api/projects").header("Authorization", owner).contentType("application/json")
            .content("{\"name\":\"Mobiliario 3D\"}")).andExpect(status().isCreated()).andReturn();
        return "/api/projects/" + json.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    JsonNode upload(String base, String owner, String name, String body) throws Exception {
        var result = mvc.perform(post(base + "/uploads").queryParam("name", name).header("Authorization", owner)
            .contentType("application/octet-stream").content(body.getBytes(StandardCharsets.ISO_8859_1))).andExpect(status().isCreated()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }

    @Test void ownerGetsTheMeshWithItsEtagAndRevalidates() throws Exception {
        String owner = token(), base = project(owner);
        var dwg = upload(base, owner, "basket.dwg", "AC1027\0\0\0\0\0\0 sólidos ACIS");
        String url = base + "/versions/" + dwg.get("id").asText() + "/solids";
        String etag = "\"" + dwg.get("sha256").asText() + "." + TESSELLATOR + "\"";

        mvc.perform(get(url).header("Authorization", owner))
            .andExpect(status().isOk())
            .andExpect(content().bytes(MESH))
            .andExpect(header().string("Content-Type", "application/gzip"))
            .andExpect(header().string("Content-Length", String.valueOf(MESH.length)))
            .andExpect(header().string("ETag", etag))
            .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.allOf(
                org.hamcrest.Matchers.containsString("no-cache"), org.hamcrest.Matchers.containsString("private"))))
            .andExpect(header().string("X-ObraCota-Format", "obracota.dwg-solids/1"))
            .andExpect(header().string("X-ObraCota-Tessellator", TESSELLATOR));
        var call = engine.calls.getFirst();
        assertEquals(UUID.fromString(base.substring("/api/projects/".length())), call.get(0));
        assertEquals(UUID.fromString(dwg.get("id").asText()), call.get(1));
        assertEquals(dwg.get("sha256").asText(), call.get(2));

        for (var tag : List.of(etag, "W/" + etag, "\"other\", " + etag, "*"))
            mvc.perform(get(url).header("Authorization", owner).header("If-None-Match", tag))
                .andExpect(status().isNotModified()).andExpect(header().string("ETag", etag)).andExpect(content().bytes(new byte[0]));
        mvc.perform(get(url).header("Authorization", owner).header("If-None-Match", "\"" + "0".repeat(64) + "." + TESSELLATOR + "\""))
            .andExpect(status().isOk()).andExpect(content().bytes(MESH));
        assertTrue(engine.closed.stream().allMatch(AtomicBoolean::get), "every engine stream is closed, also on 304");
        assertEquals(List.of("", etag, "W/" + etag, "\"other\", " + etag, "*", "\"" + "0".repeat(64) + "." + TESSELLATOR + "\""),
            engine.revalidations, "the client's If-None-Match reaches the engine");
    }

    @Test void theEnginesNotModifiedIsA304WithoutBody() throws Exception {
        String owner = token(), base = project(owner);
        var dwg = upload(base, owner, "rug.dwg", "AC1027\0\0\0\0\0\0");
        String url = base + "/versions/" + dwg.get("id").asText() + "/solids";
        String etag = "\"" + dwg.get("sha256").asText() + "." + TESSELLATOR + "\"";
        engine.unchanged.set(true);
        mvc.perform(get(url).header("Authorization", owner).header("If-None-Match", etag))
            .andExpect(status().isNotModified()).andExpect(header().string("ETag", etag)).andExpect(content().bytes(new byte[0]));
        assertTrue(engine.closed.isEmpty(), "no mesh was asked for");
    }

    @Test void onlyTheOwnerAndOnlyDwg() throws Exception {
        String owner = token(), other = token(), base = project(owner);
        var dwg = upload(base, owner, "basket.dwg", "AC1032\0\0\0\0\0\0");
        var ifc = upload(base, owner, "planta.ifc", "ISO-10303-21;\nHEADER;");
        String url = base + "/versions/" + dwg.get("id").asText() + "/solids";

        mvc.perform(get(url).header("Authorization", other)).andExpect(status().isNotFound());
        mvc.perform(get(url)).andExpect(status().isUnauthorized());
        mvc.perform(get(base + "/versions/" + ifc.get("id").asText() + "/solids").header("Authorization", owner))
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("FORMAT_NOT_SUPPORTED"));
        mvc.perform(get(base + "/versions/" + UUID.randomUUID() + "/solids").header("Authorization", owner)).andExpect(status().isNotFound());
        assertTrue(engine.calls.isEmpty(), "the engine is never asked for a version the caller cannot read");
    }

    @Test void engineErrorsKeepTheirCode() throws Exception {
        String owner = token(), base = project(owner);
        var dwg = upload(base, owner, "rug.dwg", "AC1027\0\0\0\0\0\0");
        String url = base + "/versions/" + dwg.get("id").asText() + "/solids";
        engine.failure.set(new EngineUnavailableException("ENGINE_BUSY", "El motor está teselando este DWG."));
        mvc.perform(get(url).header("Authorization", owner))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("ENGINE_BUSY"));
        engine.failure.set(new com.obracota.application.common.exception.UnprocessableApplicationException("MESH_TOO_LARGE", "Demasiados triángulos."));
        mvc.perform(get(url).header("Authorization", owner))
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("MESH_TOO_LARGE"));
    }
}
