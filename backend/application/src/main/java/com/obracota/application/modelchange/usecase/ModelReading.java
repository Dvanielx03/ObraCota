package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.model.recipe.GlobalId;
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

    private VersionRef reference(Actor actor, UUID project, UUID version) {
        Guards.reach(actor, project);
        return VersionRef.of(project, Guards.ifc(versions, actor, project, version));
    }
}
