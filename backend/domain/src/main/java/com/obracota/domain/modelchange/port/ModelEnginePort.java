package com.obracota.domain.modelchange.port;

import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelversion.model.ModelVersion;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.*;

/**
 * The model engine (in H1 the IFC engine, §5). It reads versions and verifies recipes; it never publishes anything.
 * Implementations turn the engine's answers into the application's exceptions:
 * <ul>
 *   <li>400 → {@code InvalidRequestApplicationException(code, detail)};</li>
 *   <li>404 → {@code NotFoundApplicationException(detail)};</li>
 *   <li>409 → {@code ConflictApplicationException(detail)};</li>
 *   <li>422 → {@code UnprocessableApplicationException(code, detail)}, for example {@code MODEL_TOO_LARGE};</li>
 *   <li>503 or no connection → {@code EngineUnavailableException(code, detail)}, for example {@code ENGINE_BUSY};</li>
 *   <li>any answer outside the contract → {@code EngineContractException} (502). That includes an answer the domain
 *       records reject: they validate in their constructors and throw {@link IllegalArgumentException} (for example a
 *       report with {@code ok=true} and no artifact), which must never reach the caller as a 400.</li>
 * </ul>
 * Rejections inside a recipe are not errors: they come back as data ({@code ok=false} and {@code errors}).
 * Readings return the engine's JSON as a JSON-like tree ({@code Map}, {@code List}, {@code String}, {@code Number},
 * {@code Boolean}, {@code null}).
 */
public interface ModelEnginePort {
    /** A stored version as the engine opens it: {@code originals/{project}/{version}}, checked against its SHA-256. */
    record VersionRef(UUID project, UUID version, String sha256) {
        public VersionRef {
            Objects.requireNonNull(project, "project");
            Objects.requireNonNull(version, "version");
            Objects.requireNonNull(sha256, "sha256");
        }

        public static VersionRef of(UUID project, ModelVersion version) { return new VersionRef(project, version.id(), version.sha256()); }
    }

    /** Filters of {@code /elements}; every field is optional. */
    record ElementQuery(String ifcClass, String name, String storey, String query, Integer limit, String cursor) {}

    /** Answer of {@code /preview} with {@code checks_only=true}: only the {@code check} of each operation ran. */
    record Checks(boolean ok, List<PreviewReport.OperationResult> operations) {
        public Checks { operations = operations == null ? List.of() : List.copyOf(operations); }
    }

    /** Bytes of a verified preview, with the headers of {@code /build}. The caller closes it. */
    record Build(InputStream content, long size, String sha256, String recipeSha256, boolean rebuilt) implements Closeable {
        public void close() throws IOException { content.close(); }
    }

    Map<String, Object> summary(VersionRef version);

    Map<String, Object> elements(VersionRef version, ElementQuery query);

    Map<String, Object> element(VersionRef version, String guid);

    /** Runs only the checks of every operation, writing nothing. */
    Checks check(VersionRef base, Recipe recipe);

    /** Applies the recipe on a fresh copy of the base and verifies it (layers 1, 2 and 6). */
    PreviewReport preview(VersionRef base, Recipe recipe);

    /** The verified IFC: the artifact when the engine still has it, rebuilt and verified again otherwise. */
    Build build(VersionRef base, Recipe recipe, String artifact);

    /**
     * {@link #preview(VersionRef, Recipe)} that gives up after {@code timeout}: what is left of the budget of the whole
     * request (§4.5, R1). An implementation never waits longer than its own limit either.
     */
    default PreviewReport preview(VersionRef base, Recipe recipe, Duration timeout) { return preview(base, recipe); }

    /** {@link #build(VersionRef, Recipe, String)} whose headers and whole body must arrive within {@code timeout}. */
    default Build build(VersionRef base, Recipe recipe, String artifact, Duration timeout) { return build(base, recipe, artifact); }

    /** Differences between two versions of the same project. */
    Map<String, Object> diff(UUID project, VersionRef base, VersionRef revision);
}
