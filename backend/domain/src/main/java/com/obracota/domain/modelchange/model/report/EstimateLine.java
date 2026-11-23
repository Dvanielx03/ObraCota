package com.obracota.domain.modelchange.model.report;

import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import java.math.BigDecimal;

/**
 * One line of the estimate of a change.
 * <ul>
 *   <li>{@code TYPE_CHANGE}: price of the current type ({@code before}) against the proposed one ({@code after}).</li>
 *   <li>{@code ADDITIONAL_COST}: the price of the {@code price_key} of an {@code ifc.set_property} ({@code after} only).</li>
 *   <li>{@code MATERIAL_FINISH}: the area of the pieces of an {@code ifc.set_material} × the price per m² of its key.</li>
 * </ul>
 * The keys are kept even when the price is missing, so the card can say which price is missing.
 * {@code difference} is {@code null} whenever a price is missing or cannot be used for this line.
 */
public record EstimateLine(String operation, Kind kind, String element, BigDecimal quantity, UnitPrice.Unit unit,
                           String quantitySource, String basis, PriceKey beforeKey, UnitPrice before,
                           PriceKey afterKey, UnitPrice after, BigDecimal difference) {
    public enum Kind { TYPE_CHANGE, ADDITIONAL_COST, MATERIAL_FINISH }

    public boolean known() { return difference != null; }
}
