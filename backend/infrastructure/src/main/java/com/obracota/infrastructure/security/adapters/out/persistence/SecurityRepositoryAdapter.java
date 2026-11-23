package com.obracota.infrastructure.security.adapters.out.persistence;

import com.obracota.domain.security.model.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.infrastructure.security.adapters.out.persistence.entity.*;
import com.obracota.infrastructure.security.adapters.out.persistence.repository.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.*;

@Repository @Transactional(readOnly=true)
public class SecurityRepositoryAdapter implements SecurityRepository {
    private final SecurityUserJpaRepository users;
    private final RefreshTokenJpaRepository sessions;
    public SecurityRepositoryAdapter(SecurityUserJpaRepository users, RefreshTokenJpaRepository sessions) {
        this.users=users; this.sessions=sessions;
    }
    @Transactional public void register(SecurityUser user) { users.saveAndFlush(new SecurityUserJpaEntity(user)); }
    public Optional<SecurityUser> byEmail(String email) { return users.findByEmail(email).map(SecurityUserJpaEntity::toDomain); }
    public Optional<SecurityUser> byId(UUID id) { return users.findById(id).map(SecurityUserJpaEntity::toDomain); }
    public Optional<SecurityUser> byGoogleSubject(String subject) {
        return users.findByGoogleSubject(subject).map(SecurityUserJpaEntity::toDomain);
    }
    @Transactional public boolean linkGoogle(UUID userId, String subject) { return users.linkGoogle(userId, subject) == 1; }
    @Transactional public void start(RefreshToken t) { sessions.save(new RefreshTokenJpaEntity(t)); }
    @Transactional public boolean rotate(RefreshToken t, UUID next) {
        return sessions.rotate(t.sessionId(), t.userId(), t.tokenId(), next, Instant.now()) == 1;
    }
    @Transactional public void revoke(RefreshToken t) { sessions.revoke(t.sessionId(), t.userId(), t.tokenId()); }
    public boolean active(UUID id, UUID userId) { return sessions.existsByIdAndUserIdAndExpiresAtAfter(id,userId,Instant.now()); }
}
