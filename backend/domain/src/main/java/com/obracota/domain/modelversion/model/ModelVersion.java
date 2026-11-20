package com.obracota.domain.modelversion.model;

import java.time.Instant;
import java.util.UUID;

public record ModelVersion(UUID id, UUID fileId, int revision, String name, String format, long byteSize,
                           String sha256, Instant uploadedAt, UUID uploadedBy, String uploaderEmail) {}
