package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.model.recipe.DwgHandle;
import com.obracota.domain.modelchange.model.recipe.GlobalId;
import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.domain.modelchange.port.ModelEnginePort;
import com.obracota.domain.modelchange.port.ModelEnginePort.ElementQuery;
import com.obracota.domain.modelchange.port.ModelEnginePort.VersionRef;
import com.obracota.domain.security.model.Actor;
import java.util.Map;
import java.util.UUID;

/**
 * Reading a stored IFC version through the engine: summary, elements and one element. Every reading first proves that
 * the caller owns the version, then hands the engine its reference with the SHA-256.
 * <p>
 * A {@code final} class with private fields, like {@link ModelChanges}: the agent's catalog receives it and must not
 * reach anything that publishes (J14).
 */
public final class ModelReading {
    public static final int ELEMENT_LIMIT = 50;
    public static final int QUERY_LIMIT = 200;

    private final ProjectVersions versions;
    private final ModelEnginePort engine;

    public ModelReading(ProjectVersions versions, ModelEnginePort engine) {
        this.versions = versions;
        this.engine = engine;
    }

    public Map<String, Object> summary(Actor actor, UUID project, UUID version) {
        return engine.summary(reference(actor, project, version));
    }

    public Map<String, Object> elements(Actor actor, UUID project, UUID version, ElementQuery query) {
        var filters = query == null ? new ElementQuery(null, null, null, null, null, null) : query;
        if (filters.limit() != null && (filters.limit() < 1 || filters.limit() > ELEMENT_LIMIT))
            throw new InvalidRequestApplicationException("SELECTOR_INVALID", "El límite va de 1 a " + ELEMENT_LIMIT + ".");
        if (filters.query() != null && filters.query().length() > QUERY_LIMIT)
            throw new InvalidRequestApplicationException("SELECTOR_INVALID", "El selector admite como máximo " + QUERY_LIMIT + " caracteres.");
        var reference = reference(actor, project, version);
        return engine.elements(reference, filters);
    }

    public Map<String, Object> element(Actor actor, UUID project, UUID version, String guid) {
        var reference = reference(actor, project, version);
        return engine.element(reference, GlobalId.require(guid));
    }

    /** One entity of a DWG or DXF version by its handle, with the drawing's units (the agent's «Leer la entidad marcada»). */
    public Map<String, Object> dwgEntity(Actor actor, UUID project, UUID version, String handle) {
        Guards.reach(actor, project);
        var model = Guards.changeable(versions, actor, project, version);
        if (!ModelFile.drawing(model.format()))
            throw new UnprocessableApplicationException("FORMAT_NOT_SUPPORTED", "Esta versión no es un plano DWG ni DXF.");
        return engine.dwgEntity(VersionRef.of(project, model), DwgHandle.require(handle));
    }

    /**
     * What changed from {@code base} to {@code version}: the engine's {@code /diff} (IfcDiff plus its own control of
     * openings) between two IFC revisions of the same file, keyed by GlobalId. The order of the revisions is free, so
     * a later revision can be compared against an earlier one and the other way round.
     */
    public Map<String, Object> compare(Actor actor, UUID project, UUID version, UUID base) {
        Guards.reach(actor, project);
        // Ownership first: a version of somebody else is a 404 whatever the base says.
        var revision = Guards.ifc(versions, actor, project, version);
        if (base == null) throw new InvalidRequestApplicationException("BASE_REQUIRED", "Elige la revisión con la que comparar.");
        if (base.equals(version)) throw new InvalidRequestApplicationException("SAME_VERSION", "Elige otra revisión del archivo para comparar.");
        var other = Guards.ifc(versions, actor, project, base);
        if (!revision.fileId().equals(other.fileId()))
            throw new UnprocessableApplicationException("DIFFERENT_FILE", "Solo se comparan revisiones del mismo archivo.");
        return engine.diff(project, VersionRef.of(project, other), VersionRef.of(project, revision));
    }

    private VersionRef reference(Actor actor, UUID project, UUID version) {
        Guards.reach(actor, project);
        return VersionRef.of(project, Guards.ifc(versions, actor, project, version));
    }
}
