package com.obracota.infrastructure.security.adapters.out.crypto;

import com.obracota.domain.security.port.service.PasswordService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

public class BCryptPasswordService implements PasswordService {
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);
    public String hash(String password) { return encoder.encode(password); }
    public boolean matches(String password, String hash) { return encoder.matches(password, hash); }
}
