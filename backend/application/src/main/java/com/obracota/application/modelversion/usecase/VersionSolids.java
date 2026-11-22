package com.obracota.application.modelversion.usecase;

import com.obracota.application.common.exception.ForbiddenApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.domain.modelversion.port.SolidMeshPort;
import com.obracota.domain.security.model.Actor;
import java.util.UUID;

/**
 * The ACIS solids of a stored DWG version, meshed by the engine for the viewer. It proves first that the caller owns
 * the version (404 otherwise, as every version reading) and that the version is a DWG (422 {@code FORMAT_NOT_SUPPORTED}),
 * then asks the engine with the version's SHA-256, so the engine checks it is meshing those exact bytes.
 */
public final class VersionSolids {
    static final String NOT_DWG = "Los sólidos 3D se leen de versiones DWG.";
    static final String OTHER_PROJECT = "La credencial no alcanza este proyecto.";

    private final ProjectVersions versions;
    private final SolidMeshPort engine;

    public VersionSolids(ProjectVersions versions, SolidMeshPort engine) {
        this.versions = versions;
        this.engine = engine;
    }

    public SolidMeshPort.Mesh solids(Actor actor, UUID project, UUID version) { return solids(actor, project, version, null); }

    /** As {@link #solids(Actor, UUID, UUID)}, passing the client's {@code If-None-Match} to the engine (may be null). */
    public SolidMeshPort.Mesh solids(Actor actor, UUID project, UUID version, String ifNoneMatch) {
        if (!actor.reaches(project)) throw new ForbiddenApplicationException(OTHER_PROJECT);
        var model = versions.get(project, actor.user(), version);
        if (!"DWG".equals(model.format())) throw new UnprocessableApplicationException("FORMAT_NOT_SUPPORTED", NOT_DWG);
        return engine.solids(project, model.id(), model.sha256(), ifNoneMatch);
    }
}
