package com.obracota.domain.security.port.repository;

import com.obracota.domain.security.model.*;
import java.util.Optional;
import java.util.UUID;

public interface SecurityRepository {
    void register(SecurityUser user);
    Optional<SecurityUser> byEmail(String email);
    Optional<SecurityUser> byId(UUID id);
    void start(RefreshToken token);
    boolean rotate(RefreshToken current, UUID next);
    void revoke(RefreshToken current);
    boolean active(UUID sessionId, UUID userId);
}
