package com.obracota.application.project.dto;

import com.obracota.domain.project.model.aggregate.Project;
import java.time.Instant;
import java.util.UUID;

public record ProjectResponse(UUID id, String name, boolean archived, Instant updatedAt) {
    public static ProjectResponse from(Project p) { return new ProjectResponse(p.id().value(),p.name(),p.archived(),p.updatedAt()); }
}
