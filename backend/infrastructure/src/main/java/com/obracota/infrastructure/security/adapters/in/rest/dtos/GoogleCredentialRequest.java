package com.obracota.infrastructure.security.adapters.in.rest.dtos;

import jakarta.validation.constraints.*;

/** The ID token Google Identity Services hands the page ({@code credential}). */
public record GoogleCredentialRequest(@NotBlank @Size(max=8192) String credential) {}
