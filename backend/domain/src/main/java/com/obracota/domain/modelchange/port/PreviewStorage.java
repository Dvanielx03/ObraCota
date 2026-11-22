package com.obracota.domain.modelchange.port;

import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;

/**
 * Verified previews kept by the backend, one file per preview:
 * {@code ${models.directory}/.previews/{project}/{change}/{previewId}.ifc}.
 */
public interface PreviewStorage {
    record Stored(UUID id, String sha256, long size) {}

    /**
     * Streams {@code source} into {@code {previewId}.ifc.part}, computes its SHA-256 and moves it atomically to
     * {@code {previewId}.ifc}. On any failure (including a stream cut halfway) the {@code .part} is removed and
     * nothing is left behind.
     */
    Stored write(UUID project, UUID change, UUID previewId, InputStream source) throws IOException;

    InputStream read(UUID project, UUID change, UUID previewId) throws IOException;

    boolean exists(UUID project, UUID change, UUID previewId);

    /** Removes one preview file. Best effort: it never throws. */
    void delete(UUID project, UUID change, UUID previewId);

    /** Removes every file of the change's folder. Best effort: it never throws. */
    void deleteAll(UUID project, UUID change);
}
