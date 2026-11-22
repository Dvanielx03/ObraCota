package com.obracota.domain.modelchange.model.price;

import com.obracota.domain.modelchange.model.recipe.GlobalId;
import java.util.Optional;
import java.util.regex.Pattern;

/** Key of a unit price: {@code type:<GlobalId>} for an IFC type, {@code item:<text>} for a product or an extra cost. */
public record PriceKey(String value) {
    private static final Pattern FORMAT = Pattern.compile("type:[0-9A-Za-z_$]{22}|item:[^\\x00-\\x1f]{1,60}");
    private static final String TYPE = "type:";

    public PriceKey {
        if (value == null || !FORMAT.matcher(value).matches()) throw new IllegalArgumentException("Clave de precio inválida");
    }

    public static PriceKey type(String globalId) { return new PriceKey(TYPE + GlobalId.require(globalId)); }

    public static PriceKey item(String text) { return new PriceKey("item:" + text); }

    public boolean isType() { return value.startsWith(TYPE); }

    /** The GlobalId of a {@code type:} key. */
    public Optional<String> typeId() { return isType() ? Optional.of(value.substring(TYPE.length())) : Optional.empty(); }

    @Override public String toString() { return value; }
}
