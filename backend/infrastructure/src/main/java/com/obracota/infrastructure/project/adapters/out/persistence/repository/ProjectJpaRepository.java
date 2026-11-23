package com.obracota.infrastructure.project.adapters.out.persistence.repository;

import com.obracota.infrastructure.project.adapters.out.persistence.entity.ProjectJpaEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;
import java.util.*;

public interface ProjectJpaRepository extends JpaRepository<ProjectJpaEntity,UUID> {
    Optional<ProjectJpaEntity> findByIdAndOwnerId(UUID id, UUID ownerId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from ProjectJpaEntity p where p.id=:id and p.ownerId=:ownerId")
    Optional<ProjectJpaEntity> lockOwned(UUID id, UUID ownerId);
    /** The person's projects, without the hidden ones that hold a public sample (V19). */
    List<ProjectJpaEntity> findAllByOwnerIdAndSampleIsNullOrderByCreatedAtDescIdAsc(UUID ownerId);
}
