package com.obracota.infrastructure.revittranslation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.revittranslation.port.RevitTranslationPort;
import com.obracota.domain.revittranslation.model.RevitTranslation.Status;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** RVT to IFC through the REST endpoints with a stand-in for Autodesk (no network). */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class RevitTranslationFlowTest {
    @TempDir static Path volume;
    @DynamicPropertySource static void storage(DynamicPropertyRegistry config) {
        config.add("models.directory", () -> volume.toString());
    }

    /** What the stand-in does on the next conversion: write an IFC, fail with a reason, or be off. */
    static final AtomicReference<String> mode = new AtomicReference<>("ok");
    static final List<String> keys = Collections.synchronizedList(new ArrayList<>());

    @TestConfiguration static class FakeAutodesk {
        @Bean @Primary RevitTranslationPort fakeAutodesk() {
            return new RevitTranslationPort() {
                public boolean available() { return !mode.get().equals("off"); }
                public void translate(String objectKey, Path rvt, Path ifc, Progress progress) throws java.io.IOException {
                    keys.add(objectKey);
                    assertEquals(OLE.length + 64, Files.size(rvt), "the stored RVT is sent whole");
                    progress.report(Status.TRANSLATING, "Autodesk está convirtiendo el modelo a IFC (50% complete)…");
                    if (mode.get().equals("fail")) throw new Failure("Autodesk no pudo convertir el RVT. Unsupported Revit version.");
                    Files.writeString(ifc, "ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;\n");
                }
            };
        }
    }

    static final byte[] OLE = {(byte)0xD0,(byte)0xCF,0x11,(byte)0xE0,(byte)0xA1,(byte)0xB1,0x1A,(byte)0xE1};
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    @BeforeEach void reset() { mode.set("ok"); keys.clear(); }

    String token() throws Exception {
        var response = mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web")
            .contentType("application/json").content(json.writeValueAsBytes(Map.of("email",UUID.randomUUID()+"@example.test","password","UnaClaveDePrueba!"))))
            .andExpect(status().isCreated()).andReturn().getResponse();
        return "Bearer "+json.readTree(response.getContentAsString()).get("accessToken").asText();
    }
    String project(String owner) throws Exception {
        var p=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json")
            .content("{\"name\":\"Revit\"}")).andExpect(status().isCreated()).andReturn();
        return "/api/projects/"+json.readTree(p.getResponse().getContentAsString()).get("id").asText();
    }
    JsonNode upload(String base,String owner,String name,byte[] body) throws Exception {
        var result=mvc.perform(post(base+"/uploads").queryParam("name",name).header("Authorization",owner)
            .contentType("application/octet-stream").content(body)).andExpect(status().isCreated()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }
    byte[] rvt() {
        byte[] bytes=Arrays.copyOf(OLE,OLE.length+64);
        for(int i=OLE.length;i<bytes.length;i++) bytes[i]=(byte)i;
        return bytes;
    }
    JsonNode finished(String url,String owner) throws Exception {
        for(int i=0;i<200;i++) {
            var body=json.readTree(mvc.perform(get(url).header("Authorization",owner)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
            if(body.get("status").asText().equals("DONE") || body.get("status").asText().equals("FAILED")) return body;
            Thread.sleep(50);
        }
        throw new AssertionError("La conversión no terminó");
    }

    @Test void storesTheIfcAsASiblingFileAndAddsRevisions() throws Exception {
        String owner=token(),other=token(),base=project(owner);
        mvc.perform(get(base+"/revit-translation/availability").header("Authorization",owner)).andExpect(jsonPath("$.available").value(true));
        var source=upload(base,owner,"Zona acceso.rvt",rvt());
        String url=base+"/versions/"+source.get("id").asText()+"/revit-translation";
        mvc.perform(get(url).header("Authorization",owner)).andExpect(status().isNoContent());
        mvc.perform(post(url).header("Authorization",other)).andExpect(status().isNotFound());
        mvc.perform(post(url).header("Authorization",owner)).andExpect(status().isAccepted()).andExpect(jsonPath("$.status").exists());
        var done=finished(url,owner);
        assertEquals("DONE",done.get("status").asText(),done.toString());
        assertEquals(List.of(source.get("id").asText()+".rvt"),keys);
        var result=json.readTree(mvc.perform(get(base+"/versions/"+done.get("resultVersion").asText()).header("Authorization",owner))
            .andReturn().getResponse().getContentAsString());
        assertEquals("Zona acceso.ifc",result.get("name").asText());
        assertEquals("IFC",result.get("format").asText());
        assertEquals(1,result.get("revision").asInt());
        assertEquals(result.get("fileId").asText(),done.get("resultFile").asText());
        assertNotEquals(source.get("fileId").asText(),done.get("resultFile").asText());
        // The RVT is untouched: same bytes, still its only version.
        mvc.perform(get(base+"/versions/"+source.get("id").asText()+"/original").header("Authorization",owner)).andExpect(content().bytes(rvt()));
        mvc.perform(get(base+"/files/"+source.get("fileId").asText()+"/versions").header("Authorization",owner)).andExpect(jsonPath("$.length()").value(1));
        // A second conversion adds a revision to the same IFC file.
        mvc.perform(post(url).header("Authorization",owner)).andExpect(status().isAccepted());
        var again=finished(url,owner);
        assertEquals("DONE",again.get("status").asText());
        assertEquals(done.get("resultFile").asText(),again.get("resultFile").asText());
        mvc.perform(get(base+"/files/"+done.get("resultFile").asText()+"/versions").header("Authorization",owner)).andExpect(jsonPath("$.length()").value(2));
        // Only an RVT is converted.
        var ifc=json.readTree(mvc.perform(get(base+"/versions/"+again.get("resultVersion").asText()).header("Authorization",owner)).andReturn().getResponse().getContentAsString());
        mvc.perform(post(base+"/versions/"+ifc.get("id").asText()+"/revit-translation").header("Authorization",owner))
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("NOT_RVT"));
    }

    @Test void aFailureIsSavedWithAutodeskReason() throws Exception {
        String owner=token(),base=project(owner);
        mode.set("fail");
        var source=upload(base,owner,"Modelo.rvt",rvt());
        String url=base+"/versions/"+source.get("id").asText()+"/revit-translation";
        mvc.perform(post(url).header("Authorization",owner)).andExpect(status().isAccepted());
        var failed=finished(url,owner);
        assertEquals("FAILED",failed.get("status").asText());
        assertEquals("Autodesk no pudo convertir el RVT. Unsupported Revit version.",failed.get("message").asText());
        assertTrue(failed.get("resultVersion").isNull());
        mvc.perform(get(base+"/files").header("Authorization",owner)).andExpect(jsonPath("$.length()").value(1));
    }

    @Test void withoutCredentialsItIsOff() throws Exception {
        String owner=token(),base=project(owner);
        var source=upload(base,owner,"Modelo.rvt",rvt());
        mode.set("off");
        mvc.perform(get(base+"/revit-translation/availability").header("Authorization",owner)).andExpect(jsonPath("$.available").value(false));
        mvc.perform(post(base+"/versions/"+source.get("id").asText()+"/revit-translation").header("Authorization",owner))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("APS_NOT_CONFIGURED"))
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("APS_CLIENT_ID")));
        assertTrue(keys.isEmpty());
    }
}
