package com.obracota.application.modelchange.rules;

import com.obracota.application.rulefinding.DoorRules;
import com.obracota.domain.designchange.DoorInspectionPort;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.report.Finding;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import java.math.BigDecimal;
import java.util.*;

/**
 * Notices of a preview: the engine's, plus {@code DoorRules} for every {@code ifc.change_type} on a door. The door is
 * rebuilt from the {@code before} the engine returns, which is the {@code /inspect} dictionary.
 */
public final class ChangeFindings {
    private ChangeFindings() {}

    public static PreviewReport withDoorRules(Recipe recipe, PreviewReport report, BigDecimal minimumWidth) {
        var extra = new ArrayList<Finding>();
        for (var operation : recipe.operations()) {
            if (!(operation instanceof ChangeType change)) continue;
            report.operation(change.id())
                .filter(result -> change.element().equals(result.element()))
                .flatMap(result -> door(result.before()))
                .ifPresent(door -> door.options().stream()
                    .filter(type -> change.typeId().equals(type.id()) && type.width() != null && type.height() != null)
                    .findFirst()
                    .ifPresent(type -> DoorRules.evaluate(door, type, minimumWidth).forEach(finding -> extra.add(
                        new Finding(finding.rule(), finding.status(), finding.explanation(), finding.source(), finding.element())))));
        }
        return report.withFindings(extra);
    }

    /** {@link DoorInspectionPort.Door} from the {@code /inspect} dictionary; empty when it is not one. */
    static Optional<DoorInspectionPort.Door> door(Map<String, Object> before) {
        if (before == null || !(before.get("element") instanceof String element)) return Optional.empty();
        var options = new ArrayList<DoorInspectionPort.DoorType>();
        if (before.get("options") instanceof List<?> list) {
            for (var item : list) {
                if (!(item instanceof Map<?, ?> option) || !(option.get("id") instanceof String id)) continue;
                options.add(new DoorInspectionPort.DoorType(id, text(option.get("name")), decimal(option.get("width")),
                    decimal(option.get("height")), Boolean.TRUE.equals(option.get("compatible"))));
            }
        }
        List<BigDecimal> openingSize = null;
        if (before.get("openingSize") instanceof List<?> size) {
            var values = size.stream().map(ChangeFindings::decimal).toList();
            if (values.stream().noneMatch(Objects::isNull)) openingSize = values;
        }
        return Optional.of(new DoorInspectionPort.Door(element, text(before.get("name")), text(before.get("typeId")),
            text(before.get("typeName")), decimal(before.get("width")), decimal(before.get("height")), text(before.get("opening")),
            openingSize, text(before.get("host")), before.get("loadBearing") instanceof Boolean bearing ? bearing : null,
            List.copyOf(options)));
    }

    private static String text(Object value) { return value instanceof String text ? text : null; }

    private static BigDecimal decimal(Object value) {
        return switch (value) {
            case BigDecimal decimal -> decimal;
            case Number number when Double.isFinite(number.doubleValue()) -> new BigDecimal(number.toString());
            case String text -> {
                try { yield new BigDecimal(text); } catch (NumberFormatException e) { yield null; }
            }
            case null, default -> null;
        };
    }
}
