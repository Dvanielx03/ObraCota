package com.obracota.domain.security.port.service;

import com.obracota.domain.security.model.RefreshToken;
import java.time.Instant;
import java.util.UUID;

public interface TokenService {
    Instant refreshExpiry();
    String access(RefreshToken session);
    String refresh(RefreshToken session);
    RefreshToken readRefresh(String jwt);
    RefreshToken readAccess(String jwt);
}
