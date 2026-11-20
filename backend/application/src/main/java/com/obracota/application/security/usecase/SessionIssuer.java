package com.obracota.application.security.usecase;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.domain.security.model.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.TokenService;
import java.util.UUID;

public record SessionIssuer(SecurityRepository repository, TokenService tokens) {
    public SessionResponse start(SecurityUser user) {
        var session = new RefreshToken(UUID.randomUUID(), user.id(), UUID.randomUUID(), tokens.refreshExpiry());
        repository.start(session);
        return issue(session, user);
    }
    SessionResponse issue(RefreshToken session, SecurityUser user) {
        return new SessionResponse(tokens.access(session), tokens.refresh(session), session.expiresAt(), user.email());
    }
}
