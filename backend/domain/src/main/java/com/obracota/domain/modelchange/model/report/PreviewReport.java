package com.obracota.domain.modelchange.model.report;

import java.time.Instant;
import java.util.*;

/**
 * What {@code POST /preview} of the engine returned (§5.6), plus the notices the backend adds ({@code DoorRules}).
 * <ul>
 *   <li>{@code ok} is true only when every operation is ok and layers 1, 2 and 6 pass. With {@code ok=false} there is
 *       never an artifact: nothing unverified is stored or shown in 3D.</li>
 *   <li>{@code recipeSha256} is the engine's own hash of the recipe; the backend never compares it with its own.</li>
 *   <li>{@code details} keeps verbatim, as a JSON-like tree ({@code Map}, {@code List}, {@code String},
 *       {@code Number}, {@code Boolean}, {@code null}), the sections the backend only passes through:
 *       {@code engine}, {@code base}, {@code affected}, {@code diff}, {@code validation}, {@code errors} and
 *       {@code timings_ms}.</li>
 * </ul>
 */
public record PreviewReport(boolean ok, String recipeSha256, Artifact artifact, List<OperationResult> operations,
                            List<Finding> findings, List<QuantityLine> quantities, Map<String, Object> details) {
    /** Verified IFC the engine keeps for {@code /build}, tied to the base and the recipe. */
    public record Artifact(String id, String sha256, long size, Instant expiresAt) {
        public Artifact {
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(sha256, "sha256");
        }
    }

    /**
     * Result of one operation. {@code before} and {@code after} are JSON-like trees: for {@code ifc.change_type},
     * {@code before} is the {@code /inspect} dictionary of the door.
     */
    public record OperationResult(String id, String op, boolean ok, String element, List<OperationError> errors,
                                  Map<String, Object> before, Map<String, Object> after, List<Finding> findings) {
        public OperationResult {
            errors = errors == null ? List.of() : List.copyOf(errors);
            before = tree(before);
            after = tree(after);
            findings = findings == null ? List.of() : List.copyOf(findings);
        }

        public Optional<OperationError> firstError() { return errors.stream().findFirst(); }
    }

    /** A rejection inside a recipe, with the engine's code ({@code TYPE_NOT_COMPATIBLE}, {@code VALUE_TYPE}…). */
    public record OperationError(String code, String detail) {}

    public PreviewReport {
        if (!ok) artifact = null;
        if (ok && artifact == null) throw new IllegalArgumentException("A verified preview needs its artifact");
        operations = operations == null ? List.of() : List.copyOf(operations);
        findings = findings == null ? List.of() : List.copyOf(findings);
        quantities = quantities == null ? List.of() : List.copyOf(quantities);
        details = tree(details);
    }

    /** The same report with the backend's notices after the engine's. */
    public PreviewReport withFindings(List<Finding> extra) {
        if (extra.isEmpty()) return this;
        var all = new ArrayList<>(findings);
        all.addAll(extra);
        return new PreviewReport(ok, recipeSha256, artifact, operations, all, quantities, details);
    }

    public Optional<OperationResult> operation(String id) {
        return operations.stream().filter(result -> Objects.equals(result.id(), id)).findFirst();
    }

    /** Maps may hold {@code null} values (JSON null), which {@link Map#copyOf} rejects. */
    private static Map<String, Object> tree(Map<String, Object> value) {
        return value == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(value));
    }
}
