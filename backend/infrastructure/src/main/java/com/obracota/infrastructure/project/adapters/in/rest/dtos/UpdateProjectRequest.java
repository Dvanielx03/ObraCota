package com.obracota.infrastructure.project.adapters.in.rest.dtos;

import jakarta.validation.constraints.*;

public record UpdateProjectRequest(@NotBlank @Size(max=120) String name) {}
