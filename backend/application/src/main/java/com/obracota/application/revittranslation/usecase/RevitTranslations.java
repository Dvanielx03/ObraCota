package com.obracota.application.revittranslation.usecase;

import com.obracota.application.common.exception.EngineUnavailableException;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.revittranslation.port.RevitTranslationPort;
import com.obracota.domain.modelversion.model.FileTooLargeException;
import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.revittranslation.model.RevitTranslation;
import com.obracota.domain.revittranslation.model.RevitTranslation.Status;
import com.obracota.domain.revittranslation.port.RevitTranslationRepository;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Converts a stored RVT version to IFC with the translation service and stores the IFC as a version of the sibling
 * file {@code <name>.ifc} of the same project (created when missing, a new revision otherwise). The RVT is only
 * read. The work runs on {@code executor}; each stage is saved so the page can follow it.
 */
public final class RevitTranslations implements AutoCloseable {
    public static final String UNAVAILABLE = "La conversión con Autodesk no está configurada: faltan APS_CLIENT_ID y APS_CLIENT_SECRET.";
    static final String INTERRUPTED = "La conversión se interrumpió porque el servidor se reinició. Vuelve a intentarlo.";
    private static final System.Logger LOG = System.getLogger(RevitTranslations.class.getName());

    /** What the page shows: the stage, its text and, when done, the IFC version and its file. */
    public record View(Status status, String message, UUID resultVersion, UUID resultFile) {}

    private final ProjectVersions versions;
    private final RevitTranslationRepository translations;
    private final RevitTranslationPort service;
    private final Transactions tx;
    private final Executor executor;
    private final Clock clock;

    public RevitTranslations(ProjectVersions versions, RevitTranslationRepository translations, RevitTranslationPort service,
                             Transactions tx, Executor executor, Clock clock) {
        this.versions = versions; this.translations = translations; this.service = service;
        this.tx = tx; this.executor = executor; this.clock = clock;
    }

    public boolean available(UUID project, UUID user) {
        tx.required(() -> { versions.catalog().requireOwner(project, user); return null; });
        return service.available();
    }

    /** Starts a conversion of {@code version}, or returns the one already running for it. */
    public View start(UUID project, UUID user, UUID version) {
        record Started(RevitTranslation translation, ModelVersion source, boolean fresh) {}
        var started = tx.required(() -> {
            var source = versions.get(project, user, version);
            if (!"RVT".equals(source.format()))
                throw new UnprocessableApplicationException("NOT_RVT", "Solo un original de Revit (.rvt) se convierte a IFC.");
            if (!service.available()) throw new EngineUnavailableException("APS_NOT_CONFIGURED", UNAVAILABLE);
            var current = translations.latest(version);
            if (current.isPresent() && current.get().status().running()) return new Started(current.get(), source, false);
            var queued = RevitTranslation.queue(project, version, clock.instant());
            translations.save(queued);
            return new Started(queued, source, true);
        });
        if (started.fresh()) executor.execute(() -> run(started.translation(), user, started.source().name()));
        return tx.required(() -> view(project, started.translation()));
    }

    /** The latest conversion of {@code version}, if any. */
    public Optional<View> latest(UUID project, UUID user, UUID version) {
        return tx.required(() -> {
            versions.get(project, user, version);
            return translations.latest(version).map(t -> view(project, t));
        });
    }

    /** Conversions a restart left unfinished are failed: their worker is gone. */
    public int interrupted() {
        return tx.required(() -> translations.failRunning(INTERRUPTED, clock.instant()));
    }

    /** {@code Plano.rvt} → {@code Plano.ifc}. */
    static String sibling(String name) {
        int dot = name.lastIndexOf('.');
        return (dot > 0 ? name.substring(0, dot) : name) + ".ifc";
    }

    void run(RevitTranslation queued, UUID user, String name) {
        var current = new AtomicReference<>(queued);
        UUID project = queued.projectId();
        Path rvt = null, ifc = null;
        try {
            stage(current, Status.UPLOADING, "Enviando el RVT a Autodesk…");
            rvt = Files.createTempFile("obracota-", ".rvt");
            try (var in = versions.storage().read(project, queued.versionId())) {
                Files.copy(in, rvt, StandardCopyOption.REPLACE_EXISTING);
            }
            ifc = Files.createTempFile("obracota-", ".ifc");
            service.translate(queued.versionId() + ".rvt", rvt, ifc, (status, text) -> stage(current, status, text));
            stage(current, Status.STORING, "Guardando el IFC en el proyecto…");
            Path result = ifc;
            long size = Files.size(result);
            var stored = tx.required(() -> {
                try (var in = Files.newInputStream(result)) {
                    return versions.upload(project, user, null, sibling(name), size, in);
                }
            });
            var done = current.get().done(stored.id(),
                "IFC guardado como versión " + stored.revision() + " de «" + stored.name() + "».", clock.instant());
            tx.required(() -> { translations.save(done); return null; });
        } catch (RevitTranslationPort.Failure e) {
            fail(current, e.getMessage());
        } catch (FileTooLargeException e) {
            fail(current, "El IFC convertido supera los 256 MiB que admite un proyecto.");
        } catch (IllegalArgumentException e) {
            fail(current, "Autodesk devolvió un archivo que no es un IFC válido.");
        } catch (NotFoundApplicationException e) {
            fail(current, "El proyecto o la versión ya no existen.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            fail(current, "La conversión se interrumpió.");
        } catch (Exception e) {
            LOG.log(System.Logger.Level.WARNING, "Revit translation " + queued.id() + " failed: " + e.getClass().getName());
            fail(current, "No se pudo completar la conversión con Autodesk. Vuelve a intentarlo.");
        } finally {
            delete(rvt);
            delete(ifc);
        }
    }

    private void stage(AtomicReference<RevitTranslation> current, Status status, String text) {
        var next = current.get().advance(status, text, clock.instant());
        tx.required(() -> { translations.save(next); return null; });
        current.set(next);
    }

    private void fail(AtomicReference<RevitTranslation> current, String text) {
        try {
            var failed = current.get().advance(Status.FAILED, text, clock.instant());
            tx.required(() -> { translations.save(failed); return null; });
        } catch (RuntimeException gone) {
            // The project was deleted meanwhile: its translations went with it.
        }
    }

    private View view(UUID project, RevitTranslation t) {
        UUID file = t.resultVersionId() == null ? null
            : versions.versions().find(project, t.resultVersionId()).map(ModelVersion::fileId).orElse(null);
        return new View(t.status(), t.message(), file == null ? null : t.resultVersionId(), file);
    }

    private static void delete(Path path) {
        if (path == null) return;
        try { Files.deleteIfExists(path); } catch (IOException ignored) { /* A temp file the system will clean. */ }
    }

    @Override public void close() {
        if (executor instanceof ExecutorService pool) pool.shutdownNow();
    }
}
