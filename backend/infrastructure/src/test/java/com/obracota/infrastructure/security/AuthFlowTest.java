package com.obracota.infrastructure.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class AuthFlowTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    @Test void rotatesRefreshAndRevokesSession() throws Exception {
        String credentials = "{\"email\":\"revision@example.test\",\"password\":\"UnaClaveDePrueba!\"}";
        for (var entry : new String[]{"register","login"}) {
            var result=mvc.perform(post("/api/auth/"+entry).header("X-ObraCota-Client","web")
                .contentType("application/json").content(credentials))
                .andExpect(status().is(entry.equals("register")?201:200)).andReturn();
            Cookie first=result.getResponse().getCookie("oc_refresh");
            assertTrue(first.isHttpOnly());
            var rotated=mvc.perform(post("/api/auth/refresh").header("X-ObraCota-Client","web").cookie(first))
                .andExpect(status().isOk()).andReturn();
            mvc.perform(post("/api/auth/refresh").header("X-ObraCota-Client","web").cookie(first)).andExpect(status().isUnauthorized());
            var next=rotated.getResponse().getCookie("oc_refresh");
            mvc.perform(post("/api/auth/logout").header("X-ObraCota-Client","web").cookie(next)).andExpect(status().isNoContent());
            mvc.perform(post("/api/auth/refresh").header("X-ObraCota-Client","web").cookie(next)).andExpect(status().isUnauthorized());
            var token=json.readTree(rotated.getResponse().getContentAsString()).get("accessToken").asText();
            mvc.perform(get("/api/projects").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web").contentType("application/json")
            .content(credentials)).andExpect(status().isConflict());
        mvc.perform(post("/api/auth/login").header("X-ObraCota-Client","web").contentType("application/json")
            .content(credentials.replace("UnaClaveDePrueba!","equivocada"))).andExpect(status().isUnauthorized());
    }
}
