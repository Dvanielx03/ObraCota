package com.obracota.infrastructure.security.adapters.out.persistence.entity;

import jakarta.persistence.*;
import java.util.UUID;
import com.obracota.domain.security.model.*;

@Entity @Table(name="security_user")
public class SecurityUserJpaEntity {
    @Id private UUID id;
    @Column(nullable=false, unique=true, length=254) private String email;
    @Column(name="password_hash", nullable=false) private String hash;
    @Enumerated(EnumType.STRING) private Role role;
    protected SecurityUserJpaEntity() {}
    public SecurityUserJpaEntity(SecurityUser user) {
        id=user.id(); email=user.email(); hash=user.passwordHash(); role=user.role();
    }
    public SecurityUser toDomain() { return new SecurityUser(id,email,hash,role); }
}
