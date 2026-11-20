package com.obracota.infrastructure.security.adapters.in.rest.dtos;

import jakarta.validation.constraints.*;

public record CredentialsRequest(@NotBlank @Email @Size(max=254) String email,
                                 @NotBlank @Size(max=72) String password) {}
