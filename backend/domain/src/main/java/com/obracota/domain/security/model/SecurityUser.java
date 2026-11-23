package com.obracota.domain.security.model;

import java.util.UUID;

/** {@code passwordHash} is null for an account created with Google: it cannot sign in with a password. */
public record SecurityUser(UUID id, String email, String passwordHash, Role role) {
    public boolean hasPassword() { return passwordHash != null; }
}
