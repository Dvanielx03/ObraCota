package com.obracota.infrastructure.security.google;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Without GOOGLE_CLIENT_ID (the test profile has none): an empty client id and 503 on sign-in. */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class GoogleSignInOffTest {
    @Autowired MockMvc mvc;

    @Test void isOffWithoutClientId() throws Exception {
        mvc.perform(get("/api/auth/google/config").header("X-ObraCota-Client","web"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.clientId").value(""));
        mvc.perform(post("/api/auth/google").header("X-ObraCota-Client","web").contentType("application/json")
            .content("{\"credential\":\"a.b.c\"}")).andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.code").value("GOOGLE_SIGN_IN_OFF"));
    }
}
