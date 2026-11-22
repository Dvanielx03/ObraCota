package com.obracota.infrastructure.modelversion.adapters.in.rest.controllers;

import com.obracota.application.modelversion.usecase.VersionSolids;
import com.obracota.domain.modelversion.port.SolidMeshPort;
import com.obracota.domain.security.model.Actor;
import java.io.IOException;
import java.util.Arrays;
import java.util.UUID;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * The ACIS solids of a DWG version as one mesh for the viewer: {@code GET /api/projects/{project}/versions/{version}/solids}.
 * <p>
 * The body is the engine's {@code obracota.dwg-solids/1} mesh, gzip as stored ({@code application/gzip}: the client
 * decompresses it). The mesh of a version never changes for a given tessellator, so the answer carries
 * {@code ETag: "<sha256>.<tessellator>"} and {@code Cache-Control: private, no-cache}: the browser keeps it and
 * revalidates with {@code If-None-Match}, which answers 304 without a body. The header goes on to the engine, which
 * answers «not modified» without meshing the DWG again, even when its cached mesh was evicted.
 */
@RestController
@RequestMapping("/api/projects/{project}/versions/{version}")
public class VersionSolidsController {
    private final VersionSolids solids;

    public VersionSolidsController(VersionSolids solids) { this.solids = solids; }

    @GetMapping("/solids")
    public ResponseEntity<InputStreamResource> solids(@PathVariable UUID project, @PathVariable UUID version, Actor actor,
                                                      @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        var mesh = solids.solids(actor, project, version, ifNoneMatch);
        var cache = CacheControl.noCache().cachePrivate();
        if (mesh.notModified() || matches(ifNoneMatch, mesh)) {
            close(mesh);
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(mesh.etag()).cacheControl(cache).build();
        }
        return ResponseEntity.ok().eTag(mesh.etag()).cacheControl(cache).contentLength(mesh.size())
            .contentType(MediaType.parseMediaType(mesh.mediaType()))
            .header("X-ObraCota-Format", mesh.format())
            .header("X-ObraCota-Tessellator", mesh.tessellator())
            .body(new InputStreamResource(mesh.content()));
    }

    /** RFC 9110 §13.1.2: weak comparison, a list of tags or {@code *}. */
    static boolean matches(String ifNoneMatch, SolidMeshPort.Mesh mesh) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank()) return false;
        return Arrays.stream(ifNoneMatch.split(",")).map(String::strip)
            .map(tag -> tag.startsWith("W/") ? tag.substring(2) : tag)
            .anyMatch(tag -> tag.equals("*") || tag.equals(mesh.etag()));
    }

    private static void close(SolidMeshPort.Mesh mesh) {
        try { mesh.close(); } catch (IOException ignored) { }
    }
}
