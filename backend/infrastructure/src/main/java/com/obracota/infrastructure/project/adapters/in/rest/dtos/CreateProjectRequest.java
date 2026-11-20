package com.obracota.infrastructure.project.adapters.in.rest.dtos;

import jakarta.validation.constraints.*;

public record CreateProjectRequest(@NotBlank @Size(max=120) String name) {}
