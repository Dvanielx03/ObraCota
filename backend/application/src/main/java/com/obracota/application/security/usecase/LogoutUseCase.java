package com.obracota.application.security.usecase;

import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.TokenService;
import com.obracota.application.security.exception.InvalidCredentialsException;

public record LogoutUseCase(SecurityRepository repository, TokenService tokens) {
    public void execute(String jwt) {
        try { repository.revoke(tokens.readRefresh(jwt)); }
        catch (InvalidCredentialsException expired) { /* The client can discard an expired session. */ }
    }
}
