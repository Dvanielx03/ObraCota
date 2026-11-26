package com.obracota.domain.modelchange.model.recipe;

import java.math.BigDecimal;
import java.util.Objects;
import java.util.Set;

/**
 * {@code dwg.move}: translates the entity by {@code dx}, {@code dy} in {@code unit} ({@code mm}, {@code cm}, {@code m},
 * {@code in}, {@code ft}, or {@code drawing} for the drawing's own units). The engine converts with the drawing's
 * {@code $INSUNITS}; a drawing without units only moves in drawing units.
 */
public record DwgMove(String id, String element, BigDecimal dx, BigDecimal dy, String unit) implements DwgOperation {
    public static final String OP = "dwg.move";
    public static final Set<String> UNITS = Set.of("mm", "cm", "m", "in", "ft", "drawing");
    private static final BigDecimal LIMIT = new BigDecimal("10000000");

    public DwgMove {
        id = Operation.checkId(id);
        element = DwgHandle.require(element);
        Objects.requireNonNull(dx, "dx");
        Objects.requireNonNull(dy, "dy");
        if (dx.abs().compareTo(LIMIT) > 0 || dy.abs().compareTo(LIMIT) > 0) throw new IllegalArgumentException("Desplazamiento fuera de rango");
        if (dx.signum() == 0 && dy.signum() == 0) throw new IllegalArgumentException("El desplazamiento no puede ser cero");
        if (!UNITS.contains(unit)) throw new IllegalArgumentException("Unidad inválida: mm, cm, m, in, ft o drawing");
        dx = dx.stripTrailingZeros();
        dy = dy.stripTrailingZeros();
    }

    public String op() { return OP; }

    public DwgMove withId(String value) { return new DwgMove(value, element, dx, dy, unit); }

    public String target() { return OP + "|" + element; }
}
