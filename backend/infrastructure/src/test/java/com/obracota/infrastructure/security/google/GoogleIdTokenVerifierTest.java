package com.obracota.infrastructure.security.google;

import com.obracota.infrastructure.security.adapters.out.google.GoogleIdTokenVerifier;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class GoogleIdTokenVerifierTest {
    final GoogleTokens google = new GoogleTokens("clave-1");
    final GoogleIdTokenVerifier verifier = new GoogleIdTokenVerifier(GoogleTokens.CLIENT_ID, google.source(), Clock.systemUTC());

    @Test void acceptsAValidTokenAndCachesTheKeys() {
        var identity = verifier.verify(google.token().sign()).orElseThrow();
        assertEquals("1098765432101234567890", identity.subject());
        assertEquals("ingeniera@example.test", identity.email());
        assertTrue(verifier.verify(google.token().issuer("accounts.google.com").sign()).isPresent());
        assertTrue(verifier.verify(google.token().emailVerified("true").sign()).isPresent());
        assertEquals(1, google.downloads.get(), "The JWKS is downloaded once and cached by kid");
    }

    @Test void rejectsAnotherAudience() {
        assertTrue(verifier.verify(google.token().audience("otro-cliente.apps.googleusercontent.com").sign()).isEmpty());
    }

    @Test void rejectsAnExpiredToken() {
        assertTrue(verifier.verify(google.token().expires(Instant.now().minus(Duration.ofHours(2))).sign()).isEmpty());
    }

    @Test void rejectsAnUnverifiedEmail() {
        assertTrue(verifier.verify(google.token().emailVerified(false).sign()).isEmpty());
        assertTrue(verifier.verify(google.token().emailVerified(null).sign()).isEmpty());
    }

    @Test void rejectsAnotherIssuerSignerOrKey() {
        assertTrue(verifier.verify(google.token().issuer("https://evil.example.test").sign()).isEmpty());
        assertTrue(verifier.verify(google.token().signer(GoogleTokens.generate()).sign()).isEmpty(), "Signature by a foreign key");
        assertTrue(verifier.verify(google.token().keyId("desconocida").sign()).isEmpty());
        assertTrue(verifier.verify("no.es.un-jwt").isEmpty());
        assertTrue(verifier.verify("").isEmpty());
    }

    @Test void refetchesAtMostOncePerMinuteForUnknownKids() {
        verifier.verify(google.token().keyId("rotada").sign());
        verifier.verify(google.token().keyId("rotada").sign());
        assertEquals(1, google.downloads.get());
    }

    @Test void isOffWithoutClientId() {
        var off = new GoogleIdTokenVerifier("  ", google.source(), Clock.systemUTC());
        assertFalse(off.enabled());
        assertTrue(off.verify(google.token().sign()).isEmpty());
        assertEquals(0, google.downloads.get());
    }
}
