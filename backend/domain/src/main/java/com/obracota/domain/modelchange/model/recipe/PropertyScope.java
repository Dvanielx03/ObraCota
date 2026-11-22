package com.obracota.domain.modelchange.model.recipe;

import java.util.Arrays;

/** Where {@code ifc.set_property} writes: on the piece itself or on its type (which every inheriting piece sees). */
public enum PropertyScope {
    OCCURRENCE("occurrence"), TYPE("type");

    private final String wire;

    PropertyScope(String wire) { this.wire = wire; }

    /** The value in {@code obracota.recipe/1}. */
    public String wire() { return wire; }

    public static PropertyScope of(String wire) {
        return Arrays.stream(values()).filter(scope -> scope.wire.equals(wire)).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("El alcance es occurrence o type"));
    }
}
