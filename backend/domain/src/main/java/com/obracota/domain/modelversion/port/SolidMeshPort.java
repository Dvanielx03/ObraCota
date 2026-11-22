package com.obracota.domain.modelversion.port;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import java.util.UUID;

/**
 * The ACIS solids of a stored DWG version as one triangle mesh, made by the model engine ({@code /dwg/solids}).
 * The engine caches the mesh by the SHA-256 of the original and the version of its tessellator, so the pair is a
 * stable identity of the bytes: {@link Mesh#etag()}.
 * <p>
 * The content is the engine's format {@code obracota.dwg-solids/1}, gzip-compressed (documented in
 * {@code ifc-engine/obracota_engine/dwg/meshfile.py}); the port passes it through without decoding it.
 * Implementations map the engine's answers like {@code ModelEnginePort}: 400, 404, 409, 422 with its code, 503 or no
 * connection as unavailable, anything else as a contract error.
 * <p>
 * With {@code ifNoneMatch} the engine answers «not modified» when that header names the current mesh, without
 * meshing the DWG again: {@link Mesh#notModified()} is then true and the content is empty.
 */
public interface SolidMeshPort {
    /** The mesh bytes and their identity. The caller closes it. */
    record Mesh(InputStream content, long size, String sourceSha256, String tessellator, String format, String mediaType,
                boolean notModified) implements Closeable {
        public Mesh {
            Objects.requireNonNull(content, "content");
            Objects.requireNonNull(sourceSha256, "sourceSha256");
            Objects.requireNonNull(tessellator, "tessellator");
            if (!sourceSha256.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("sourceSha256");
            if (!tessellator.matches("[A-Za-z0-9._-]{1,64}")) throw new IllegalArgumentException("tessellator");
            if (size < 0) throw new IllegalArgumentException("size");
        }

        public Mesh(InputStream content, long size, String sourceSha256, String tessellator, String format, String mediaType) {
            this(content, size, sourceSha256, tessellator, format, mediaType, false);
        }

        /** The engine's «not modified»: the caller already holds the mesh with this identity. */
        public static Mesh unchanged(String sourceSha256, String tessellator, String format) {
            return new Mesh(InputStream.nullInputStream(), 0, sourceSha256, tessellator, format, "application/gzip", true);
        }

        /** Strong validator of the content: the original's SHA-256 and the tessellator that meshed it. */
        public String etag() { return "\"" + sourceSha256 + "." + tessellator + "\""; }

        @Override public void close() throws IOException { content.close(); }
    }

    /** The mesh, or {@link Mesh#notModified()} when {@code ifNoneMatch} (may be null) names the current one. */
    Mesh solids(UUID project, UUID version, String sha256, String ifNoneMatch);

    default Mesh solids(UUID project, UUID version, String sha256) { return solids(project, version, sha256, null); }
}
