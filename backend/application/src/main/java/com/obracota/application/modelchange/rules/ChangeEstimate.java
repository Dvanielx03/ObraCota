package com.obracota.application.modelchange.rules;

import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.recipe.SetProperty;
import com.obracota.domain.modelchange.model.report.Estimate;
import com.obracota.domain.modelchange.model.report.EstimateLine;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.model.report.QuantityLine;
import java.math.BigDecimal;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Estimate of a change (§6.3), in plain Java. Nothing is invented: a missing price leaves the difference empty.
 * <ul>
 *   <li>{@code ifc.change_type}: 1 {@code UNIT}; before, the price of {@code type:<current type>} (read from the
 *       report's {@code before}); after, the price of {@code type:<proposed type>}; difference, after minus before.</li>
 *   <li>{@code ifc.set_property} with {@code price_key}: «Costo adicional», 1 {@code UNIT} × the price of the key.</li>
 *   <li>{@code ifc.set_property} without {@code price_key}: no line.</li>
 * </ul>
 * A price only enters a difference when it is in {@code COP} and per {@code UNIT}, the unit of these lines;
 * otherwise it is shown but the difference stays empty.
 */
public final class ChangeEstimate {
    public static final String CURRENCY = UnitPrice.COP;
    private static final String UNIT_BASIS = "Por unidad";
    private static final String EXTRA_BASIS = "Costo adicional por unidad";

    private ChangeEstimate() {}

    public static Estimate of(Recipe recipe, PreviewReport report, List<UnitPrice> prices) {
        Map<PriceKey, UnitPrice> book = prices.stream()
            .collect(Collectors.toMap(UnitPrice::key, Function.identity(), (first, second) -> first));
        var lines = new ArrayList<EstimateLine>();
        for (var operation : recipe.operations()) {
            switch (operation) {
                case ChangeType change -> {
                    var current = currentType(report, change);
                    var beforeKey = current.map(PriceKey::type).orElse(null);
                    var afterKey = PriceKey.type(change.typeId());
                    var before = beforeKey == null ? null : book.get(beforeKey);
                    var after = book.get(afterKey);
                    BigDecimal difference = usable(before) && usable(after) ? after.amount().subtract(before.amount()) : null;
                    lines.add(new EstimateLine(change.id(), EstimateLine.Kind.TYPE_CHANGE, change.element(), BigDecimal.ONE,
                        UnitPrice.Unit.UNIT, "UNIT", basis(report, change.element()), beforeKey, before, afterKey, after, difference));
                }
                case SetProperty property when property.priceKey() != null -> {
                    var after = book.get(property.priceKey());
                    BigDecimal difference = usable(after) ? after.amount() : null;
                    lines.add(new EstimateLine(property.id(), EstimateLine.Kind.ADDITIONAL_COST, property.element(), BigDecimal.ONE,
                        UnitPrice.Unit.UNIT, "UNIT", EXTRA_BASIS, null, null, property.priceKey(), after, difference));
                }
                case SetProperty ignored -> { }
            }
        }
        return Estimate.of(CURRENCY, lines);
    }

    private static boolean usable(UnitPrice price) {
        return price != null && CURRENCY.equals(price.currency()) && price.unit() == UnitPrice.Unit.UNIT;
    }

    /** The current type of the door, from the report of this same operation on this same element. */
    private static Optional<String> currentType(PreviewReport report, ChangeType change) {
        if (report == null) return Optional.empty();
        return report.operation(change.id())
            .filter(result -> change.element().equals(result.element()))
            .map(result -> result.before().get("typeId"))
            .filter(String.class::isInstance).map(String.class::cast);
    }

    /** How the engine counted the element after the change, when it says so per unit. */
    private static String basis(PreviewReport report, String element) {
        if (report == null) return UNIT_BASIS;
        return report.quantities().stream()
            .filter(line -> element.equals(line.element()) && "after".equals(line.phase()) && "UNIT".equals(line.unit()))
            .map(QuantityLine::basis).filter(Objects::nonNull).findFirst().orElse(UNIT_BASIS);
    }
}
