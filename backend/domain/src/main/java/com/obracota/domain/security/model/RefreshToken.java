package com.obracota.domain.security.model;

import java.time.Instant;
import java.util.UUID;

public record RefreshToken(UUID sessionId, UUID userId, UUID tokenId, Instant expiresAt) {}
