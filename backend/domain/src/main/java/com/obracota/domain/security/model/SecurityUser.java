package com.obracota.domain.security.model;

import java.util.UUID;

public record SecurityUser(UUID id, String email, String passwordHash, Role role) {}
