package com.obracota.infrastructure.security.adapters.out.persistence.repository;

import com.obracota.infrastructure.security.adapters.out.persistence.entity.SecurityUserJpaEntity;
import org.springframework.data.jpa.repository.*;
import java.util.*;

public interface SecurityUserJpaRepository extends JpaRepository<SecurityUserJpaEntity,UUID> {
    Optional<SecurityUserJpaEntity> findByEmail(String email);
    Optional<SecurityUserJpaEntity> findByGoogleSubject(String googleSubject);
    @Modifying(flushAutomatically=true, clearAutomatically=true)
    @Query("update SecurityUserJpaEntity u set u.googleSubject=:subject where u.id=:id and u.googleSubject is null")
    int linkGoogle(UUID id, String subject);
}
