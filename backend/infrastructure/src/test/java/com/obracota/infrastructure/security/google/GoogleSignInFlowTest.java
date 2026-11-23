package com.obracota.infrastructure.security.google;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.domain.security.port.service.GoogleIdentityVerifier;
import com.obracota.infrastructure.security.adapters.out.google.GoogleIdTokenVerifier;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

/** «Continuar con Google» end to end with a local key and a stub JWKS: the session is the same one login issues. */
@SpringBootTest(properties = "security.google.client-id=" + GoogleTokens.CLIENT_ID) @AutoConfigureMockMvc @ActiveProfiles("test")
class GoogleSignInFlowTest {
    static final GoogleTokens GOOGLE = new GoogleTokens("clave-flujo");
    @TestBean GoogleIdentityVerifier googleVerifier;
    static GoogleIdentityVerifier googleVerifier() {
        return new GoogleIdTokenVerifier(GoogleTokens.CLIENT_ID, GOOGLE.source(), Clock.systemUTC());
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    ResultActions google(String credential) throws Exception {
        return mvc.perform(post("/api/auth/google").header("X-ObraCota-Client","web").contentType("application/json")
            .content(json.writeValueAsString(Map.of("credential", credential))));
    }

    @Test void publishesTheClientId() throws Exception {
        mvc.perform(get("/api/auth/google/config").header("X-ObraCota-Client","web"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.clientId").value(GoogleTokens.CLIENT_ID));
    }

    @Test void createsTheAccountThenSignsItIn() throws Exception {
        var token = GOOGLE.token().subject("sub-nueva").email("Nueva.Google@Example.test").sign();
        var first = google(token).andExpect(status().isCreated()).andExpect(jsonPath("$.created").value(true)).andExpect(jsonPath("$.email").value("nueva.google@example.test"))
            .andExpect(jsonPath("$.accessToken").isNotEmpty()).andReturn();
        var cookie = first.getResponse().getCookie("oc_refresh");
        assertNotNull(cookie);
        assertTrue(cookie.isHttpOnly());
        var access = json.readTree(first.getResponse().getContentAsString()).get("accessToken").asText();
        mvc.perform(get("/api/projects").header("Authorization","Bearer "+access)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/refresh").header("X-ObraCota-Client","web").cookie(cookie)).andExpect(status().isOk());
        // Signing in again finds the same account by its Google sub.
        google(token).andExpect(status().isOk()).andExpect(jsonPath("$.created").value(false)).andExpect(jsonPath("$.email").value("nueva.google@example.test"));
        // Without a password, the account cannot sign in with one.
        mvc.perform(post("/api/auth/login").header("X-ObraCota-Client","web").contentType("application/json")
            .content("{\"email\":\"nueva.google@example.test\",\"password\":\"cualquier-clave\"}")).andExpect(status().isUnauthorized());
        // Registering the same email with a password is a conflict, as for any taken email.
        mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web").contentType("application/json")
            .content("{\"email\":\"nueva.google@example.test\",\"password\":\"UnaClaveDePrueba!\"}")).andExpect(status().isConflict());
    }

    @Test void linksAnExistingPasswordAccount() throws Exception {
        String credentials = "{\"email\":\"con-clave@example.test\",\"password\":\"UnaClaveDePrueba!\"}";
        mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web").contentType("application/json").content(credentials))
            .andExpect(status().isCreated());
        google(GOOGLE.token().subject("sub-con-clave").email("con-clave@example.test").sign())
            .andExpect(status().isOk()).andExpect(jsonPath("$.email").value("con-clave@example.test"));
        mvc.perform(post("/api/auth/login").header("X-ObraCota-Client","web").contentType("application/json").content(credentials))
            .andExpect(status().isOk());
        // Another Google account with the same email cannot take it over.
        google(GOOGLE.token().subject("sub-intrusa").email("con-clave@example.test").sign()).andExpect(status().isUnauthorized());
    }

    @Test void rejectsInvalidTokens() throws Exception {
        google(GOOGLE.token().audience("otro.apps.googleusercontent.com").subject("sub-x").email("x@example.test").sign())
            .andExpect(status().isUnauthorized());
        google(GOOGLE.token().emailVerified(false).subject("sub-y").email("y@example.test").sign()).andExpect(status().isUnauthorized());
        google(GOOGLE.token().expires(Instant.now().minusSeconds(7200)).subject("sub-z").email("z@example.test").sign())
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/google").header("X-ObraCota-Client","web").contentType("application/json").content("{}"))
            .andExpect(status().isBadRequest());
    }
}
