package com.obracota.domain.modelchange.model.report;

import java.math.BigDecimal;

/**
 * A quantity the engine measured for an affected element, before or after the change, with where it came from:
 * {@code source} is {@code UNIT}, {@code QTO} (exported in the IFC) or {@code GEOMETRY} (computed), and
 * {@code basis} says how in words. {@code reliable=false} marks a mesh that is not closed.
 */
public record QuantityLine(String element, String phase, BigDecimal quantity, String unit, String source, String basis, boolean reliable) {}
