package com.obracota.application.security.usecase;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.domain.security.model.RefreshToken;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.TokenService;
import java.util.UUID;

public record RefreshUseCase(SecurityRepository repository, TokenService tokens, SessionIssuer sessions) {
    public SessionResponse execute(String jwt) {
        var current = tokens.readRefresh(jwt);
        var next = UUID.randomUUID();
        if (!repository.rotate(current, next)) throw new InvalidCredentialsException();
        var user = repository.byId(current.userId()).orElseThrow(InvalidCredentialsException::new);
        return sessions.issue(new RefreshToken(current.sessionId(), current.userId(), next, current.expiresAt()), user);
    }
}
