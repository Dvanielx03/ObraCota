package com.obracota.application.project.usecase;

import com.obracota.application.project.exception.ProjectNotFoundApplicationException;
import com.obracota.domain.common.event.DomainEventPublisher;
import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.UserId;

public record DeleteProjectUseCase(ProjectRepository repository, DomainEventPublisher publisher) {
    public void execute(ProjectId id, UserId owner) {
        var project=repository.findForUpdate(id,owner).orElseThrow(ProjectNotFoundApplicationException::new);
        project.delete();
        repository.delete(project);
        project.domainEvents().forEach(publisher::publish);
        project.clearDomainEvents();
    }
}
