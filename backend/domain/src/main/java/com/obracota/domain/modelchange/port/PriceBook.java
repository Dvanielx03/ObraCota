package com.obracota.domain.modelchange.port;

import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import java.math.BigDecimal;
import java.util.*;

/** Unit prices per version ({@code unit_price}) and the project's minimum door width ({@code door_project_minimum}). */
public interface PriceBook {
    List<UnitPrice> prices(UUID project, UUID version);

    /** Inserts the price, or replaces the one with the same key in that version. */
    void put(UUID project, UUID version, UnitPrice price);

    Optional<BigDecimal> minimumWidth(UUID project);

    void minimumWidth(UUID project, BigDecimal width);

    /**
     * Copies into {@code to} every price of {@code from} whose key {@code to} lacks, with the same amount, source and
     * date and {@code copiedFrom = from}. Returns what was copied.
     */
    default List<UnitPrice> copyMissing(UUID project, UUID from, UUID to) {
        var present = new HashSet<PriceKey>();
        prices(project, to).forEach(price -> present.add(price.key()));
        var copied = new ArrayList<UnitPrice>();
        for (var price : prices(project, from)) {
            if (present.contains(price.key())) continue;
            var copy = price.asCopyFrom(from);
            put(project, to, copy);
            copied.add(copy);
        }
        return copied;
    }
}
