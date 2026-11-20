package com.obracota.infrastructure.project.adapters.out.persistence.mapper;

import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.security.model.UserId;
import com.obracota.infrastructure.project.adapters.out.persistence.entity.ProjectJpaEntity;

public class ProjectPersistenceMapper {
    public ProjectJpaEntity toNewEntity(Project p) { return new ProjectJpaEntity(p.id().value(),p.owner().value(),p.name()); }
    public void synchronize(Project p, ProjectJpaEntity entity) { entity.name=p.name(); }
    public Project toDomain(ProjectJpaEntity e) { return Project.restore(new ProjectId(e.id),new UserId(e.ownerId),e.name); }
}
