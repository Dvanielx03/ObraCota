package com.obracota.infrastructure.project.adapters.out.persistence;

import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.UserId;
import com.obracota.infrastructure.project.adapters.out.persistence.mapper.ProjectPersistenceMapper;
import com.obracota.infrastructure.project.adapters.out.persistence.repository.ProjectJpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Repository @Transactional(readOnly=true)
public class ProjectRepositoryAdapter implements ProjectRepository {
    private final ProjectJpaRepository rows;
    private final ProjectPersistenceMapper mapper;
    public ProjectRepositoryAdapter(ProjectJpaRepository rows, ProjectPersistenceMapper mapper) {
        this.rows=rows; this.mapper=mapper;
    }
    public Optional<Project> findById(ProjectId id, UserId owner) {
        return rows.findByIdAndOwnerId(id.value(),owner.value()).map(mapper::toDomain);
    }
    public List<Project> findAll(UserId owner) {
        return rows.findAllByOwnerIdAndSampleIsNullOrderByCreatedAtDescIdAsc(owner.value()).stream().map(mapper::toDomain).toList();
    }
    @Transactional public Optional<Project> findForUpdate(ProjectId id, UserId owner) {
        return rows.lockOwned(id.value(),owner.value()).map(mapper::toDomain);
    }
    @Transactional public void save(Project project) {
        rows.findByIdAndOwnerId(project.id().value(),project.owner().value()).ifPresentOrElse(
            row -> mapper.synchronize(project,row), () -> rows.save(mapper.toNewEntity(project)));
    }
    @Transactional public void delete(Project project) { rows.deleteById(project.id().value()); }
}
