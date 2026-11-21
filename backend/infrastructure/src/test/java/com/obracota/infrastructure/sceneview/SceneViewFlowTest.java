package com.obracota.infrastructure.sceneview;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.file.Path;
import java.util.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class SceneViewFlowTest {
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
    byte[] view(String name) throws Exception {
        return json.writeValueAsBytes(Map.of("name",name,"position",List.of(4.5,3.0,-2.0),"target",List.of(0.0,1.0,0.0),"span",1.75));
    }
    @Test void savesRenamesAndDeletesViewsOnlyForTheOwner() throws Exception {
        String owner=token(),other=token();
        var p=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json")
            .content("{\"name\":\"Obra con vistas\"}")).andExpect(status().isCreated()).andReturn();
        String base="/api/projects/"+json.readTree(p.getResponse().getContentAsString()).get("id").asText();
        var upload=mvc.perform(post(base+"/uploads").queryParam("name","planta.ifc").header("Authorization",owner)
            .contentType("application/octet-stream").content("ISO-10303-21;\nvistas")).andExpect(status().isCreated()).andReturn();
        String views=base+"/versions/"+json.readTree(upload.getResponse().getContentAsString()).get("id").asText()+"/views";

        mvc.perform(get(views).header("Authorization",owner)).andExpect(content().json("[]"));
        var saved=mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(view("  Acceso norte  ")))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("Acceso norte"))
            .andExpect(jsonPath("$.position[0]").value(4.5)).andExpect(jsonPath("$.target[1]").value(1.0))
            .andExpect(jsonPath("$.span").value(1.75)).andReturn();
        String one=views+"/"+json.readTree(saved.getResponse().getContentAsString()).get("id").asText();

        // Datos inválidos: sin nombre, nombre largo, vector incompleto y zoom no positivo.
        for (var bad:List.of(Map.of("name"," ","position",List.of(1,1,1),"target",List.of(0,0,0),"span",1),
                Map.of("name","x".repeat(61),"position",List.of(1,1,1),"target",List.of(0,0,0),"span",1),
                Map.of("name","Corta","position",List.of(1,1),"target",List.of(0,0,0),"span",1),
                Map.of("name","Sin altura","position",List.of(1,1,1),"target",List.of(0,0,0),"span",0),
                Map.of("name","Sin dirección","position",List.of(1,1,1),"target",List.of(1,1,1),"span",1)))
            mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(json.writeValueAsBytes(bad)))
                .andExpect(status().isBadRequest());

        // Otra cuenta no ve ni toca nada.
        mvc.perform(get(views).header("Authorization",other)).andExpect(status().isNotFound());
        mvc.perform(post(views).header("Authorization",other).contentType("application/json").content(view("Ajena"))).andExpect(status().isNotFound());
        mvc.perform(put(one).header("Authorization",other).contentType("application/json").content("{\"name\":\"Ajena\"}")).andExpect(status().isNotFound());
        mvc.perform(delete(one).header("Authorization",other)).andExpect(status().isNotFound());

        mvc.perform(put(one).header("Authorization",owner).contentType("application/json").content("{\"name\":\"Fachada\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Fachada"));
        mvc.perform(put(one).header("Authorization",owner).contentType("application/json").content("{\"name\":\"\"}")).andExpect(status().isBadRequest());
        mvc.perform(put(views+"/"+UUID.randomUUID()).header("Authorization",owner).contentType("application/json").content("{\"name\":\"Nada\"}"))
            .andExpect(status().isNotFound());
        mvc.perform(get(views).header("Authorization",owner)).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].name").value("Fachada"));

        // Tope por versión.
        for (int i=1;i<24;i++)
            mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(view("Vista "+i))).andExpect(status().isCreated());
        mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(view("De más"))).andExpect(status().isBadRequest());

        mvc.perform(delete(one).header("Authorization",owner)).andExpect(status().isNoContent());
        mvc.perform(delete(one).header("Authorization",owner)).andExpect(status().isNotFound());
        mvc.perform(get(views).header("Authorization",owner)).andExpect(jsonPath("$.length()").value(23));
    }
}
