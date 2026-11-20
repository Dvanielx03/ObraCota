package com.obracota.infrastructure.security.adapters.out.persistence.repository;

import com.obracota.infrastructure.security.adapters.out.persistence.entity.RefreshTokenJpaEntity;
import org.springframework.data.jpa.repository.*;
import java.time.Instant;
import java.util.UUID;

public interface RefreshTokenJpaRepository extends JpaRepository<RefreshTokenJpaEntity,UUID> {
    @Modifying @Query("update RefreshTokenJpaEntity t set t.tokenId=:next where t.id=:session and t.userId=:user and t.tokenId=:previous and t.expiresAt>:now")
    int rotate(UUID session, UUID user, UUID previous, UUID next, Instant now);
    @Modifying @Query("delete from RefreshTokenJpaEntity t where t.id=:session and t.userId=:user and t.tokenId=:token")
    int revoke(UUID session, UUID user, UUID token);
    boolean existsByIdAndUserIdAndExpiresAtAfter(UUID session, UUID user, Instant now);
}
