package com.obracota.domain.revittranslation.model;

import java.time.Instant;
import java.util.UUID;

/**
 * A conversion of a stored Revit RVT version to IFC by Autodesk Model Derivative. The RVT is never modified:
 * the IFC becomes a version of a sibling file ({@code <name>.ifc}) of the same project.
 */
public record RevitTranslation(UUID id, UUID projectId, UUID versionId, Status status, String message,
                               UUID resultVersionId, Instant createdAt, Instant updatedAt) {
    public enum Status {
        QUEUED, UPLOADING, TRANSLATING, STORING, DONE, FAILED;
        /** Still working: neither finished nor failed. */
        public boolean running() { return this != DONE && this != FAILED; }
    }

    public static RevitTranslation queue(UUID project, UUID version, Instant now) {
        return new RevitTranslation(UUID.randomUUID(), project, version, Status.QUEUED, "En cola para enviar a Autodesk.", null, now, now);
    }

    public RevitTranslation advance(Status next, String text, Instant now) {
        return new RevitTranslation(id, projectId, versionId, next, text, resultVersionId, createdAt, now);
    }

    public RevitTranslation done(UUID result, String text, Instant now) {
        return new RevitTranslation(id, projectId, versionId, Status.DONE, text, result, createdAt, now);
    }
}
