package com.obracota.domain.modelchange.model.report;

import java.math.BigDecimal;
import java.util.List;
import java.util.Objects;

/**
 * Estimate of a change. {@code total} adds the known differences only; {@code complete=false} means some price is
 * missing and the card says «Faltan precios para estimar el total». While the change is a proposal it is computed on
 * read with the base prices; on approval it is frozen.
 */
public record Estimate(String currency, List<EstimateLine> lines, BigDecimal total, boolean complete) {
    public Estimate {
        Objects.requireNonNull(currency, "currency");
        lines = List.copyOf(lines);
        Objects.requireNonNull(total, "total");
    }

    public static Estimate of(String currency, List<EstimateLine> lines) {
        var total = lines.stream().filter(EstimateLine::known).map(EstimateLine::difference).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new Estimate(currency, lines, total, lines.stream().allMatch(EstimateLine::known));
    }
}
