package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.ConflictApplicationException;
import com.obracota.application.common.exception.ForbiddenApplicationException;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.port.ModelChangeRepository;
import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.security.model.Actor;
import java.io.Closeable;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

/** Checks and texts shared by the model change use cases. */
final class Guards {
    static final String OTHER_PROJECT = "La credencial del agente no alcanza este proyecto.";
    static final String PUBLISH = "Publicar, restaurar y fijar precios exigen la sesión de la propietaria.";
    static final String NOT_OWN = "El agente solo trabaja sobre sus propios borradores.";
    static final String NOT_IFC = "Selecciona una versión IFC.";
    static final String NOT_CHANGEABLE = "Los cambios de modelo trabajan sobre un IFC o un plano DWG/DXF.";
    static final String STALE = "La base ya no es la última revisión (v%d).";
    static final String STALE_PUBLISH = "Abre la revisión más reciente para proponer o revertir un cambio.";
    static final String MODIFIED = "El cambio se modificó; recarga.";
    static final String CHANGE_MISSING = "El cambio no existe.";

    private Guards() {}

    /** First line of every use case: an agent only works inside the project of its credential. */
    static void reach(Actor actor, UUID project) {
        if (!actor.reaches(project)) throw new ForbiddenApplicationException(OTHER_PROJECT);
    }

    /** Publishing, restoring and pricing are the person's. This is the layer that holds even without HTTP. */
    static void person(Actor actor) {
        if (!actor.person()) throw new ForbiddenApplicationException(PUBLISH);
    }

    static void touch(Actor actor, ModelChange change) {
        if (!change.touchableBy(actor)) throw new ForbiddenApplicationException(NOT_OWN);
    }

    /** The version, owned by the actor's user, and IFC (H1 answers 422 for DWG). */
    static ModelVersion ifc(ProjectVersions versions, Actor actor, UUID project, UUID version) {
        var model = versions.get(project, actor.user(), version);
        if (!"IFC".equals(model.format())) throw new UnprocessableApplicationException("FORMAT_NOT_SUPPORTED", NOT_IFC);
        return model;
    }

    /** The version, owned by the actor's user, that model changes work on: an IFC, or a DWG or DXF drawing. */
    static ModelVersion changeable(ProjectVersions versions, Actor actor, UUID project, UUID version) {
        var model = versions.get(project, actor.user(), version);
        if (!"IFC".equals(model.format()) && !ModelFile.drawing(model.format()))
            throw new UnprocessableApplicationException("FORMAT_NOT_SUPPORTED", NOT_CHANGEABLE);
        return model;
    }

    static ModelVersion latest(ProjectVersions versions, Actor actor, UUID project, UUID file) {
        return versions.list(project, actor.user(), file).getFirst();
    }

    /** 409 with {@code message} (which may hold the latest revision as {@code %d}) when {@code base} is not the latest. */
    static void requireLatest(ProjectVersions versions, Actor actor, UUID project, ModelVersion base, String message) {
        var latest = latest(versions, actor, project, base.fileId());
        if (!latest.id().equals(base.id())) throw new ConflictApplicationException(message.formatted(latest.revision()));
    }

    static ModelChange load(ModelChangeRepository changes, UUID project, UUID id) {
        return changes.find(project, id).orElseThrow(() -> new NotFoundApplicationException(CHANGE_MISSING));
    }

    static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Best-effort cleanup after a commit: it must never undo what was already confirmed. */
    static void quietly(Runnable cleanup) {
        try { cleanup.run(); } catch (RuntimeException ignored) { }
    }

    static void close(Closeable resource) {
        try { resource.close(); } catch (Exception ignored) { }
    }
}
