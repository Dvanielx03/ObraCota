package com.obracota.application.security.dto;

import java.time.Instant;

public record SessionResponse(String accessToken, String refreshToken, Instant expiresAt, String email) {}
