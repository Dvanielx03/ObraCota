package com.obracota.domain.modelchange.model.report;

import java.util.Objects;

/**
 * A design notice, from the engine or from the backend rules. {@code status} is {@code WARNING}, {@code OK} or
 * {@code UNKNOWN} (the card shows «Aviso», «Comprobado» and «Sin evaluar»).
 */
public record Finding(String rule, String status, String explanation, String source, String element) {
    public Finding {
        Objects.requireNonNull(rule, "rule");
        Objects.requireNonNull(status, "status");
    }
}
