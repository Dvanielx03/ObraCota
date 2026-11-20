package com.obracota.domain.project.model.valueobject;

import java.util.Objects;
import java.util.UUID;

public record ProjectId(UUID value) {
    public ProjectId { Objects.requireNonNull(value); }
    public static ProjectId generate() { return new ProjectId(UUID.randomUUID()); }
}
