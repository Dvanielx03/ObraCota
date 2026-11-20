package com.obracota.application.project.usecase;

import com.obracota.application.project.dto.ProjectResponse;
import com.obracota.application.project.exception.ProjectNotFoundApplicationException;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.UserId;

public record GetProjectByIdUseCase(ProjectRepository repository) {
    public ProjectResponse execute(ProjectId id, UserId owner) {
        return repository.findById(id,owner).map(ProjectResponse::from).orElseThrow(ProjectNotFoundApplicationException::new);
    }
}
