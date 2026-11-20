package com.obracota.application.security.usecase;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.domain.security.model.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.PasswordService;
import java.util.Locale;
import java.util.UUID;
import java.nio.charset.StandardCharsets;

public record RegisterUseCase(SecurityRepository repository, PasswordService passwords, SessionIssuer sessions) {
    public SessionResponse execute(String email, String password) {
        String normalized = email.strip().toLowerCase(Locale.ROOT);
        if (password.length() < 10 || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("Longitud de contraseña inválida");
        var user = new SecurityUser(UUID.randomUUID(), normalized, passwords.hash(password), Role.DESIGNER);
        repository.register(user);
        return sessions.start(user);
    }
}
