package com.obracota.application.security.usecase;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.domain.security.model.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.PasswordService;
import java.util.Locale;
import java.util.UUID;
import java.nio.charset.StandardCharsets;

public record LoginUseCase(SecurityRepository repository, PasswordService passwords, SessionIssuer sessions) {
    public SessionResponse execute(String email, String password) {
        String normalized = email.strip().toLowerCase(Locale.ROOT);
        var user = repository.byEmail(normalized).orElseThrow(InvalidCredentialsException::new);
        if (password.getBytes(StandardCharsets.UTF_8).length > 72 || !passwords.matches(password, user.passwordHash()))
            throw new InvalidCredentialsException();
        return sessions.start(user);
    }
}
