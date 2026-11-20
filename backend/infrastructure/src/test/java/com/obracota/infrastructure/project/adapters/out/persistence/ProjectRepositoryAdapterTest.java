package com.obracota.infrastructure.project.adapters.out.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class ProjectRepositoryAdapterTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    String register(String email) throws Exception {
        var response=mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web").contentType("application/json")
            .content("{\"email\":\""+email+"\",\"password\":\"UnaClaveDePrueba!\"}")).andExpect(status().isCreated()).andReturn();
        return "Bearer "+json.readTree(response.getResponse().getContentAsString()).get("accessToken").asText();
    }
    @Test void onlyOwnerCanReadEditOrDelete() throws Exception {
        var owner=register("owner@example.test");
        var other=register("other@example.test");
        mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json").content("{\"name\":\"   \"}"))
            .andExpect(status().isBadRequest());
        var create=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json").content("{\"name\":\"Piscina\"}"))
            .andExpect(status().isCreated()).andReturn();
        var path=create.getResponse().getHeader("Location");
        mvc.perform(get(path).header("Authorization",owner)).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Piscina"));
        mvc.perform(get("/api/projects").header("Authorization",other)).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get(path).header("Authorization",other)).andExpect(status().isNotFound());
        mvc.perform(put(path).header("Authorization",other).contentType("application/json").content("{\"name\":\"Otro\"}")).andExpect(status().isNotFound());
        mvc.perform(delete(path).header("Authorization",other)).andExpect(status().isNotFound());
        mvc.perform(put(path).header("Authorization",owner).contentType("application/json").content("{\"name\":\"Renombrado\"}")).andExpect(status().isOk());
        mvc.perform(get("/api/projects").header("Authorization",owner)).andExpect(jsonPath("$[0].name").value("Renombrado"));
        mvc.perform(delete(path).header("Authorization",owner)).andExpect(status().isNoContent());
        mvc.perform(get(path).header("Authorization",owner)).andExpect(status().isNotFound());
    }
}
