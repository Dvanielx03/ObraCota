package com.obracota.infrastructure.security.adapters.out.persistence.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import com.obracota.domain.security.model.RefreshToken;

@Entity @Table(name="refresh_token")
public class RefreshTokenJpaEntity {
    @Id private UUID id;
    private UUID userId;
    private UUID tokenId;
    private Instant expiresAt;
    protected RefreshTokenJpaEntity() {}
    public RefreshTokenJpaEntity(RefreshToken token) {
        id=token.sessionId(); userId=token.userId(); tokenId=token.tokenId(); expiresAt=token.expiresAt();
    }
}
