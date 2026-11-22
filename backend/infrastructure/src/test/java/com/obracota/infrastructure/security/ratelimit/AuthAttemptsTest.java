package com.obracota.infrastructure.security.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** R3.6: brute-force limits of login and registration, with small limits in a context of their own. */
@SpringBootTest(properties = {"security.attempts.per-address=6", "security.attempts.failed-logins=3"})
@AutoConfigureMockMvc @ActiveProfiles("test")
class AuthAttemptsTest {
    @Autowired MockMvc mvc;

    /** A clock the test moves by hand. */
    static final class Manual extends Clock {
        Instant now = Instant.parse("2026-11-22T12:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    String credentials(String email, String password) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
    }

    org.springframework.test.web.servlet.ResultActions call(String path, String body, String address) throws Exception {
        return mvc.perform(post("/api/auth/" + path).header("X-ObraCota-Client", "web").contentType("application/json")
            .content(body).with(request -> { request.setRemoteAddr(address); return request; }));
    }

    @Test void failedLoginsBlockTheAccountAndASuccessClearsThem() throws Exception {
        var email = UUID.randomUUID() + "@example.test";
        call("register", credentials(email, "UnaClaveDePrueba!"), "10.0.0.1").andExpect(status().isCreated());
        for (int i = 0; i < 2; i++)
            call("login", credentials(email, "equivocada"), "10.0.0.2").andExpect(status().isUnauthorized());
        call("login", credentials(email, "UnaClaveDePrueba!"), "10.0.0.2").andExpect(status().isOk());
        for (int i = 0; i < 3; i++)
            call("login", credentials(email, "equivocada"), "10.0.0.3").andExpect(status().isUnauthorized());
        // From any address, even with the right password, until the window passes.
        call("login", credentials(email.toUpperCase(), "UnaClaveDePrueba!"), "10.0.0.4")
            .andExpect(status().isTooManyRequests()).andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.code").value("TOO_MANY_ATTEMPTS"))
            .andExpect(jsonPath("$.message").value("Demasiados intentos. Espera unos minutos y vuelve a intentarlo."));
    }

    @Test void oneAddressHasABoundedNumberOfAttempts() throws Exception {
        for (int i = 0; i < 6; i++)
            call("register", credentials(UUID.randomUUID() + "@example.test", "UnaClaveDePrueba!"), "10.0.1.1")
                .andExpect(status().isCreated());
        call("register", credentials(UUID.randomUUID() + "@example.test", "UnaClaveDePrueba!"), "10.0.1.1")
            .andExpect(status().isTooManyRequests());
        call("login", credentials(UUID.randomUUID() + "@example.test", "UnaClaveDePrueba!"), "10.0.1.1")
            .andExpect(status().isTooManyRequests());
        call("register", credentials(UUID.randomUUID() + "@example.test", "UnaClaveDePrueba!"), "10.0.1.2")
            .andExpect(status().isCreated());
    }

    @Test void theWindowSlides() {
        var clock = new Manual();
        var limiter = new AttemptLimiter(2, Duration.ofMinutes(1), clock);
        assertTrue(limiter.tryAcquire("k"));
        clock.now = clock.now.plusSeconds(30);
        assertTrue(limiter.tryAcquire("k"));
        assertFalse(limiter.tryAcquire("k"));
        assertEquals(Duration.ofSeconds(30), limiter.retryAfter("k"));
        clock.now = clock.now.plusSeconds(30);
        assertTrue(limiter.tryAcquire("k"), "the first attempt left the window");
        assertFalse(limiter.tryAcquire("other") && limiter.tryAcquire("other") && limiter.tryAcquire("other"));
        limiter.clear("other");
        assertTrue(limiter.tryAcquire("other"));
        assertEquals(1, AuthAttempts.seconds(Duration.ofMillis(10)));
        assertEquals(30, AuthAttempts.seconds(Duration.ofSeconds(30)));
    }
}
