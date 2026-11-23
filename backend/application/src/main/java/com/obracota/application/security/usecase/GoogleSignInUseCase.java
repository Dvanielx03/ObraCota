package com.obracota.application.security.usecase;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.application.security.exception.GoogleSignInUnavailableException;
import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.domain.security.model.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.GoogleIdentityVerifier;
import java.util.Locale;
import java.util.UUID;

/**
 * Signs in with a Google ID token. The account is found by its linked Google {@code sub}, then by the verified email
 * (an existing password account gets linked); otherwise a new account without password is created. The session is the
 * same one {@link LoginUseCase} starts.
 */
public record GoogleSignInUseCase(SecurityRepository repository, GoogleIdentityVerifier verifier, SessionIssuer sessions) {
    /** The session, and whether this sign-in created the account (a new person meets the onboarding). */
    public record Outcome(SessionResponse session, boolean created) {}

    public SessionResponse execute(String credential) { return signIn(credential).session(); }

    public Outcome signIn(String credential) {
        if (!verifier.enabled()) throw new GoogleSignInUnavailableException();
        var identity = verifier.verify(credential).orElseThrow(InvalidCredentialsException::new);
        var linked = repository.byGoogleSubject(identity.subject());
        if (linked.isPresent()) return new Outcome(sessions.start(linked.get()), false);
        String email = identity.email().strip().toLowerCase(Locale.ROOT);
        var existing = repository.byEmail(email);
        var user = existing.orElseGet(() -> {
            var created = new SecurityUser(UUID.randomUUID(), email, null, Role.DESIGNER);
            repository.register(created);
            return created;
        });
        // An account already linked to another Google account keeps it.
        if (!repository.linkGoogle(user.id(), identity.subject())) throw new InvalidCredentialsException();
        return new Outcome(sessions.start(user), existing.isEmpty());
    }
}
