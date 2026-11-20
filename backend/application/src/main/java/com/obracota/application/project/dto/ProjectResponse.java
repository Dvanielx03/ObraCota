package com.obracota.application.project.dto;

import com.obracota.domain.project.model.aggregate.Project;
import java.util.UUID;

public record ProjectResponse(UUID id, String name) {
    public static ProjectResponse from(Project p) { return new ProjectResponse(p.id().value(),p.name()); }
}
