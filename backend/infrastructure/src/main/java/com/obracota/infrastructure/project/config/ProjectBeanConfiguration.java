package com.obracota.infrastructure.project.config;

import com.obracota.application.project.usecase.*;
import com.obracota.domain.common.event.DomainEventPublisher;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.infrastructure.project.adapters.out.persistence.mapper.ProjectPersistenceMapper;
import org.springframework.context.annotation.*;

@Configuration
public class ProjectBeanConfiguration {
    @Bean ProjectPersistenceMapper mapper() { return new ProjectPersistenceMapper(); }
    @Bean RegisterProjectUseCase createProject(ProjectRepository r, DomainEventPublisher p) { return new RegisterProjectUseCase(r,p); }
    @Bean UpdateProjectUseCase updateProject(ProjectRepository r, DomainEventPublisher p) { return new UpdateProjectUseCase(r,p); }
    @Bean ArchiveProjectUseCase archiveProject(ProjectRepository r, DomainEventPublisher p) { return new ArchiveProjectUseCase(r,p); }
    @Bean DeleteProjectUseCase deleteProject(ProjectRepository r, DomainEventPublisher p) { return new DeleteProjectUseCase(r,p); }
    @Bean GetProjectByIdUseCase getProject(ProjectRepository r) { return new GetProjectByIdUseCase(r); }
    @Bean ListProjectUseCase listProjects(ProjectRepository r) { return new ListProjectUseCase(r); }
}
