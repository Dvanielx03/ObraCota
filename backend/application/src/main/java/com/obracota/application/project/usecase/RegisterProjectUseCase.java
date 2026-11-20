package com.obracota.application.project.usecase;

import com.obracota.application.project.command.RegisterProjectCommand;
import com.obracota.application.project.dto.ProjectResponse;
import com.obracota.domain.common.event.DomainEventPublisher;
import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.port.repository.ProjectRepository;

public record RegisterProjectUseCase(ProjectRepository repository, DomainEventPublisher publisher) {
    public ProjectResponse execute(RegisterProjectCommand command) {
        var project=Project.register(command.owner(),command.name());
        repository.save(project);
        project.domainEvents().forEach(publisher::publish);
        project.clearDomainEvents();
        return ProjectResponse.from(project);
    }
}
