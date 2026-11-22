package com.obracota.infrastructure.modelversion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class ModelVersionFlowTest {
    @TempDir static Path volume;
    @DynamicPropertySource static void storage(DynamicPropertyRegistry config) {
        config.add("models.directory", () -> volume.toString());
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    String token() throws Exception {
        var response = mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web")
            .contentType("application/json").content(json.writeValueAsBytes(Map.of("email",UUID.randomUUID()+"@example.test","password","UnaClaveDePrueba!"))))
            .andExpect(status().isCreated()).andReturn().getResponse();
        return "Bearer "+json.readTree(response.getContentAsString()).get("accessToken").asText();
    }
    JsonNode upload(String url,String owner,String body) throws Exception {
        var result=mvc.perform(post(url).queryParam("name","planta.ifc").header("Authorization",owner)
            .contentType("application/octet-stream").content(body)).andExpect(status().isCreated()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }
    @Test void scopesVersionsAndNotesAndPreservesBothOriginals() throws Exception {
        String owner=token(),other=token();
        var p=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json")
            .content("{\"name\":\"Obra de prueba\"}")).andExpect(status().isCreated()).andReturn();
        String id=json.readTree(p.getResponse().getContentAsString()).get("id").asText();
        String base="/api/projects/"+id;
        String original="ISO-10303-21;\noriginal";
        var first=upload(base+"/uploads",owner,original);
        var next=upload(base+"/uploads",owner,original+" R2");
        assertEquals(first.get("fileId"),next.get("fileId"));
        assertEquals(2,next.get("revision").asInt());
        assertNotEquals(first.get("sha256"),next.get("sha256"));
        String v1=base+"/versions/"+first.get("id").asText(),v2=base+"/versions/"+next.get("id").asText();
        mvc.perform(get(v1+"/original").header("Authorization",owner)).andExpect(content().bytes(original.getBytes(StandardCharsets.UTF_8)));
        for(String endpoint:List.of(base+"/files",v1,v1+"/original",v1+"/notes"))
            mvc.perform(get(endpoint).header("Authorization",other)).andExpect(status().isNotFound());
        for(boolean imported:List.of(false,true))
            mvc.perform(put(v1+"/notes").header("Authorization",owner).contentType("application/json").content(json.writeValueAsBytes(
                Map.of("key","A","text",imported?"local":"original","onlyIfAbsent",imported)))).andExpect(status().isNoContent());
        mvc.perform(get(v1+"/notes").header("Authorization",owner)).andExpect(jsonPath("$.A").value("original"));
        mvc.perform(get(v2+"/notes").header("Authorization",owner)).andExpect(content().json("{}"));
        mvc.perform(post(base+"/uploads").param("name","invalid.dwg").header("Authorization",owner)
            .contentType("application/octet-stream").content(original)).andExpect(status().isBadRequest());
        try(var files=Files.list(volume.resolve(id))) { assertEquals(2,files.count()); }
        mvc.perform(delete(base).header("Authorization",owner)).andExpect(status().isNoContent());
        assertFalse(Files.exists(volume.resolve(id)));
    }
    @Test void keepsFbxAndObjOriginalsAsVersions() throws Exception {
        String owner=token();
        var p=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json")
            .content("{\"name\":\"Mobiliario\"}")).andExpect(status().isCreated()).andReturn();
        String base="/api/projects/"+json.readTree(p.getResponse().getContentAsString()).get("id").asText();
        byte[] fbx=new byte[700];
        System.arraycopy("Kaydara FBX Binary  \0".getBytes(StandardCharsets.US_ASCII),0,fbx,0,21);
        for(int i=21;i<fbx.length;i++) fbx[i]=(byte)(i*7);
        byte[] obj="# 3ds Max Wavefront OBJ Exporter\nmtllib PK60.mtl\no Solid2\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n".getBytes(StandardCharsets.UTF_8);
        for(var upload:List.of(Map.entry("PK60.FBX",fbx),Map.entry("PK60.obj",obj))) {
            var result=mvc.perform(post(base+"/uploads").queryParam("name",upload.getKey()).header("Authorization",owner)
                .contentType("application/octet-stream").content(upload.getValue())).andExpect(status().isCreated()).andReturn();
            var version=json.readTree(result.getResponse().getContentAsString());
            assertEquals(upload.getKey().substring(upload.getKey().length()-3).toUpperCase(Locale.ROOT),version.get("format").asText());
            mvc.perform(get(base+"/versions/"+version.get("id").asText()+"/original").header("Authorization",owner))
                .andExpect(content().bytes(upload.getValue()));
        }
        // Same file name and extension as the OBJ, with FBX bytes: the header check refuses it.
        mvc.perform(post(base+"/uploads").queryParam("name","PK60.obj").header("Authorization",owner)
            .contentType("application/octet-stream").content(fbx)).andExpect(status().isBadRequest());
        mvc.perform(post(base+"/uploads").queryParam("name","PK60.skp").header("Authorization",owner)
            .contentType("application/octet-stream").content(obj)).andExpect(status().isBadRequest());
    }
}
