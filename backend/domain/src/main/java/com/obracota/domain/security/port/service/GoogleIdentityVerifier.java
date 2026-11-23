package com.obracota.domain.security.port.service;

import com.obracota.domain.security.model.GoogleIdentity;
import java.util.Optional;

/** Checks a Google ID token (signature, issuer, audience, expiry and verified email). */
public interface GoogleIdentityVerifier {
    /** False when no OAuth client id is configured: «Continuar con Google» is off. */
    boolean enabled();
    /** The identity of a valid token; empty for any token that fails a check. */
    Optional<GoogleIdentity> verify(String credential);
}
