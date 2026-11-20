package com.obracota.infrastructure.security.adapters.out.persistence.repository;

import com.obracota.infrastructure.security.adapters.out.persistence.entity.SecurityUserJpaEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface SecurityUserJpaRepository extends JpaRepository<SecurityUserJpaEntity,UUID> {
    Optional<SecurityUserJpaEntity> findByEmail(String email);
}
