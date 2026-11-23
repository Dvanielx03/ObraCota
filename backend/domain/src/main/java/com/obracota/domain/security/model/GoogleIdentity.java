package com.obracota.domain.security.model;

import java.util.Objects;

/** A person Google vouched for: the stable account id ({@code sub}) and the verified email of a Google ID token. */
public record GoogleIdentity(String subject, String email) {
    public GoogleIdentity {
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(email, "email");
    }
}
