package com.obracota.application.project.usecase;

import com.obracota.application.project.dto.ProjectResponse;
import com.obracota.application.project.exception.ProjectNotFoundApplicationException;
import com.obracota.domain.common.event.DomainEventPublisher;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.UserId;

public record ArchiveProjectUseCase(ProjectRepository repository, DomainEventPublisher publisher) {
    public ProjectResponse execute(ProjectId id, UserId owner, boolean archived) {
        var project=repository.findForUpdate(id,owner).orElseThrow(ProjectNotFoundApplicationException::new);
        project.archive(archived);
        repository.save(project);
        project.domainEvents().forEach(publisher::publish);
        project.clearDomainEvents();
        return ProjectResponse.from(project);
    }
}
