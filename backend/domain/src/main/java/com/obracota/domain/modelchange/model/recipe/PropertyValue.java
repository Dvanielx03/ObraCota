package com.obracota.domain.modelchange.model.recipe;

import java.math.BigDecimal;
import java.util.Objects;

/**
 * Value of {@code ifc.set_property}: text, a JSON boolean or a finite number. {@code null}, lists and objects do not
 * exist here on purpose: with {@code should_purge=True} a {@code None} would delete the property.
 */
public sealed interface PropertyValue permits PropertyValue.Text, PropertyValue.Bool, PropertyValue.Number {
    int TEXT_LIMIT = 255;

    /** Plain Java value: {@code String}, {@code Boolean} or {@code BigDecimal}. */
    Object raw();

    record Text(String value) implements PropertyValue {
        public Text {
            if (value == null || value.isEmpty() || value.length() > TEXT_LIMIT || value.chars().anyMatch(Character::isISOControl))
                throw new IllegalArgumentException("El texto va de 1 a 255 caracteres, sin caracteres de control");
        }
        public Object raw() { return value; }
    }

    record Bool(boolean value) implements PropertyValue {
        public Object raw() { return value; }
    }

    record Number(BigDecimal value) implements PropertyValue {
        public Number { Objects.requireNonNull(value, "value"); }
        public Object raw() { return value; }
    }
}
