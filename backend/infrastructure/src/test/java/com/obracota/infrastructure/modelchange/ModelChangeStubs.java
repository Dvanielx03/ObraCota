package com.obracota.infrastructure.modelchange;

import com.obracota.domain.designchange.DoorInspectionPort;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.port.ModelEnginePort;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Stubs of the engine for the Spring tests (§8.2): {@code ModelEnginePort} answers an ok report whose artifact is
 * minimal IFC with a revision comment and its real SHA-256, and {@code DoorInspectionPort} answers the Duplex door.
 * A change to {@link #INCOMPATIBLE} previews with {@code ok=false}. {@link Mode#CUT} cuts the {@code /build} stream halfway.
 */
public final class ModelChangeStubs {
    public static final String DOOR = "1hOSvn6df7F8_7GcBWlS8Z", CURRENT = "0hOSvn6df7F8_7GcBWlS8Y",
        ALTERNATE = "2klOFZffH6WQFlV10uM1wF", INCOMPATIBLE = "3klOFZffH6WQFlV10uM1wG";

    public enum Mode { OK, CUT }

    private ModelChangeStubs() {}

    @TestConfiguration
    public static class Beans {
        @Bean @Primary public Engine stubEngine() { return new Engine(); }
        @Bean @Primary public DoorInspectionPort stubDoors() { return new Doors(); }
        @Bean @Primary public MutableClock stubClock() { return new MutableClock(Instant.now()); }
    }

    public static final class MutableClock extends Clock {
        private final AtomicReference<Instant> now;

        public MutableClock(Instant start) { now = new AtomicReference<>(start); }

        public void set(Instant instant) { now.set(instant); }

        public void advance(Duration duration) { now.updateAndGet(value -> value.plus(duration)); }

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }

        @Override public Clock withZone(ZoneId zone) { return this; }

        @Override public Instant instant() { return now.get(); }
    }

    public static final class Doors implements DoorInspectionPort {
        @Override public Door inspect(UUID project, UUID version, String element) { return door(element); }
    }

    static DoorInspectionPort.Door door(String element) {
        var width = new BigDecimal("0.762");
        var height = new BigDecimal("2.032");
        return new DoorInspectionPort.Door(element, "Puerta P80", CURRENT, "P80", width, height, "2opening000000000000000",
            List.of(new BigDecimal("0.81"), new BigDecimal("2.06")), "3host0000000000000000a", null,
            List.of(new DoorInspectionPort.DoorType(ALTERNATE, "P80B", width, height, true),
                new DoorInspectionPort.DoorType(INCOMPATIBLE, "P100", new BigDecimal("1.0"), height, false)));
    }

    static Map<String, Object> inspectTree(String element) {
        var tree = new LinkedHashMap<String, Object>();
        var door = door(element);
        tree.put("element", door.element());
        tree.put("name", door.name());
        tree.put("typeId", door.typeId());
        tree.put("typeName", door.typeName());
        tree.put("width", door.width());
        tree.put("height", door.height());
        tree.put("opening", door.opening());
        tree.put("openingSize", door.openingSize());
        tree.put("host", door.host());
        tree.put("loadBearing", null);
        tree.put("options", door.options().stream().map(type -> Map.<String, Object>of("id", type.id(), "name", type.name(),
            "width", type.width(), "height", type.height(), "compatible", type.compatible())).toList());
        return tree;
    }

    public static final class Engine implements ModelEnginePort {
        public volatile Mode mode = Mode.OK;
        /** Thrown by {@code preview} instead of answering, as the adapter would for a 503 or a 422 of the engine. */
        public volatile RuntimeException failure;
        /** Every preview answers {@code ok=false}, whatever the recipe (a READY recipe is frozen). */
        public volatile boolean rejectAll;
        /** How long {@code check} waits, so two edits overlap. */
        public volatile long checkPauseMillis;
        public final AtomicInteger previews = new AtomicInteger();
        private final Map<String, byte[]> artifacts = new ConcurrentHashMap<>();

        /** Back to the default answers; a Spring context shares this stub between the tests of a class. */
        public void reset() {
            mode = Mode.OK;
            failure = null;
            rejectAll = false;
            checkPauseMillis = 0;
        }

        @Override public Map<String, Object> summary(VersionRef version) { return Map.of("schema", "IFC2X3"); }

        @Override public Map<String, Object> elements(VersionRef version, ElementQuery query) { return Map.of("items", List.of(), "total", 0); }

        @Override public Map<String, Object> element(VersionRef version, String guid) { return Map.of("guid", guid); }

        @Override public Map<String, Object> dwgEntity(VersionRef version, String handle) {
            return Map.of("handle", handle, "type", "MTEXT", "layer", "Text", "color", 256, "text", "LIVING ROOM",
                "plain_text", "LIVING ROOM", "position", List.of(130.1, 170.7), "units", Map.of("insunits", 6, "name", "m", "to_mm", 1000));
        }

        @Override public Checks check(VersionRef base, Recipe recipe) {
            if (checkPauseMillis > 0) {
                try {
                    Thread.sleep(checkPauseMillis);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            return new Checks(true, recipe.operations().stream().map(operation -> new PreviewReport.OperationResult(operation.id(),
                operation.op(), true, operation.element(), List.of(), null, null, List.of())).toList());
        }

        @Override public PreviewReport preview(VersionRef base, Recipe recipe) {
            var thrown = failure;
            if (thrown != null) throw thrown;
            int n = previews.incrementAndGet();
            var results = new ArrayList<PreviewReport.OperationResult>();
            boolean ok = !rejectAll;
            for (var operation : recipe.operations()) {
                boolean fits = !rejectAll && !(operation instanceof ChangeType change && INCOMPATIBLE.equals(change.typeId()));
                ok &= fits;
                Map<String, Object> after = operation instanceof ChangeType change ? Map.of("typeId", change.typeId()) : Map.of();
                results.add(new PreviewReport.OperationResult(operation.id(), operation.op(), fits, operation.element(),
                    fits ? List.of() : List.of(new PreviewReport.OperationError("TYPE_NOT_COMPATIBLE", "El tipo no es de igual medida.")),
                    operation instanceof ChangeType ? inspectTree(operation.element()) : Map.of(), after, List.of()));
            }
            var details = new LinkedHashMap<String, Object>();
            details.put("engine", Map.of("version", "stub"));
            details.put("diff", Map.of("changed", List.of(), "added", List.of(), "deleted", List.of(), "unexpected", List.of()));
            details.put("validation", Map.of("layers", List.of()));
            if (!ok) return new PreviewReport(false, "recipe", null, results, List.of(), List.of(), details);
            // A drawing's revision is a DXF: a 999 comment, then the first section, as VolumeStorage checks it.
            var bytes = (recipe.drawing() ? "999\nrev " + n + "\n  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n  0\nEOF\n"
                : "ISO-10303-21;\n/* rev " + n + " */").getBytes(StandardCharsets.UTF_8);
            var id = HexFormat.of().formatHex(Arrays.copyOf(sha256(("artifact" + n).getBytes(StandardCharsets.UTF_8)), 16));
            artifacts.put(id, bytes);
            return new PreviewReport(true, "recipe", new PreviewReport.Artifact(id, HexFormat.of().formatHex(sha256(bytes)), bytes.length,
                Instant.now().plusSeconds(900)), results, List.of(), List.of(), details);
        }

        @Override public Build build(VersionRef base, Recipe recipe, String artifact) {
            var bytes = artifacts.remove(artifact);
            if (bytes == null) throw new AssertionError("Unknown artifact " + artifact);
            var sha = HexFormat.of().formatHex(sha256(bytes));
            InputStream content = new ByteArrayInputStream(bytes);
            if (mode == Mode.CUT) content = new Cut(content, bytes.length / 2);
            return new Build(content, bytes.length, sha, "recipe", false);
        }

        /** Names the two revisions it was given, in order, so a test can tell which one is the base. */
        @Override public Map<String, Object> diff(UUID project, VersionRef base, VersionRef revision) {
            return Map.of("changed", List.of(Map.of("guid", DOOR, "class", "IfcDoor", "flags", List.of("type_changed"))),
                "added", List.of(), "deleted", List.of(), "unexpected", List.of(),
                "compared", List.of(base.version().toString(), revision.version().toString()));
        }
    }

    /** A {@code /build} body that breaks after {@code limit} bytes, like a 503 halfway through the stream. */
    static final class Cut extends FilterInputStream {
        private int left;

        Cut(InputStream in, int limit) {
            super(in);
            left = limit;
        }

        @Override public int read() throws IOException {
            if (left-- <= 0) throw new IOException("stream cut");
            return super.read();
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) throw new IOException("stream cut");
            int n = super.read(b, off, Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }

    static byte[] sha256(byte[] bytes) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(bytes);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String sha256Hex(byte[] bytes) { return HexFormat.of().formatHex(sha256(bytes)); }
}
