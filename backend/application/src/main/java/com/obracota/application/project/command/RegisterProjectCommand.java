package com.obracota.application.project.command;

import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.security.model.UserId;
import java.util.Objects;

public record RegisterProjectCommand(UserId owner, String name) {
    public RegisterProjectCommand {
        Objects.requireNonNull(owner);
        Objects.requireNonNull(name);
    }
}
