package com.obracota.application.modelchange.rules;

import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.recipe.DwgOperation;
import com.obracota.domain.modelchange.model.recipe.SetMaterial;
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
 *   <li>{@code ifc.set_material}: «Acabado», the area in m² the engine measured after the change for the pieces of the
 *       list (walls by one face, roofs and slabs in plan) × the price per {@code M2} of its key ({@code item:<material>}
 *       by default). Without that price, or with a price in another unit, the difference stays empty.</li>
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
                case SetMaterial finish -> lines.add(finish(finish, report, book));
                // A drawing change has no quantities nor prices: its estimate is empty (N/A in the card).
                case DwgOperation ignored -> { }
            }
        }
        return Estimate.of(CURRENCY, lines);
    }

    private static EstimateLine finish(SetMaterial finish, PreviewReport report, Map<PriceKey, UnitPrice> book) {
        var key = finish.effectivePriceKey();
        var price = book.get(key);
        var pieces = new HashSet<>(finish.elements());
        BigDecimal area = null;
        int measured = 0;
        if (report != null) {
            for (var line : report.quantities()) {
                if (line.element() == null || !pieces.contains(line.element()) || !"after".equals(line.phase())
                    || !"M2".equals(line.unit()) || line.quantity() == null) continue;
                area = (area == null ? BigDecimal.ZERO : area).add(line.quantity());
                measured++;
            }
        }
        var basis = area == null ? "Previsualiza el cambio para medir el área de las " + pieces.size() + " piezas"
            : "Área de " + measured + " de " + pieces.size() + " piezas: muros por una cara, cubiertas y losas en planta";
        var source = report == null ? null : report.quantities().stream()
            .filter(line -> line.element() != null && pieces.contains(line.element()) && "after".equals(line.phase()))
            .map(QuantityLine::source).filter(Objects::nonNull).findFirst().orElse(null);
        BigDecimal difference = area != null && price != null && CURRENCY.equals(price.currency()) && price.unit() == UnitPrice.Unit.M2
            ? area.multiply(price.amount()).setScale(2, java.math.RoundingMode.HALF_UP) : null;
        return new EstimateLine(finish.id(), EstimateLine.Kind.MATERIAL_FINISH, finish.element(),
            area == null ? null : area.setScale(2, java.math.RoundingMode.HALF_UP), UnitPrice.Unit.M2, source, basis,
            null, null, key, price, difference);
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
