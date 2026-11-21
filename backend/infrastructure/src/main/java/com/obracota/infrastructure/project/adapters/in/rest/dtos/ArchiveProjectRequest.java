package com.obracota.infrastructure.project.adapters.in.rest.dtos;

import jakarta.validation.constraints.NotNull;

public record ArchiveProjectRequest(@NotNull Boolean archived) {}
