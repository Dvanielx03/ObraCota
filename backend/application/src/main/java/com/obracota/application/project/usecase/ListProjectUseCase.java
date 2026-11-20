package com.obracota.application.project.usecase;

import com.obracota.application.project.dto.ProjectResponse;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.UserId;
import java.util.List;

public record ListProjectUseCase(ProjectRepository repository) {
    public List<ProjectResponse> execute(UserId owner) {
        return repository.findAll(owner).stream().map(ProjectResponse::from).toList();
    }
}
