package com.obracota.application.project.usecase;

import com.obracota.application.project.command.UpdateProjectCommand;
import com.obracota.application.project.dto.ProjectResponse;
import com.obracota.application.project.exception.ProjectNotFoundApplicationException;
import com.obracota.domain.common.event.DomainEventPublisher;
import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.port.repository.ProjectRepository;

public record UpdateProjectUseCase(ProjectRepository repository, DomainEventPublisher publisher) {
    public ProjectResponse execute(UpdateProjectCommand command) {
        var project=repository.findForUpdate(command.id(),command.owner()).orElseThrow(ProjectNotFoundApplicationException::new);
        project.rename(command.name());
        repository.save(project);
        project.domainEvents().forEach(publisher::publish);
        project.clearDomainEvents();
        return ProjectResponse.from(project);
    }
}
