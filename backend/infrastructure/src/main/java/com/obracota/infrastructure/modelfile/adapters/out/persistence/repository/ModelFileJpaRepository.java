package com.obracota.infrastructure.modelfile.adapters.out.persistence.repository;

import com.obracota.infrastructure.modelfile.adapters.out.persistence.entity.ModelFileJpaEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface ModelFileJpaRepository extends JpaRepository<ModelFileJpaEntity,UUID> {
    Optional<ModelFileJpaEntity> findByProjectIdAndId(UUID project, UUID id);
    Optional<ModelFileJpaEntity> findByProjectIdAndName(UUID project,String name);
    List<ModelFileJpaEntity> findAllByProjectIdOrderByName(UUID project);
}
