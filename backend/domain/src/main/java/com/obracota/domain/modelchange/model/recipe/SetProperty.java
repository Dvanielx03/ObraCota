package com.obracota.domain.modelchange.model.recipe;

import com.obracota.domain.modelchange.model.price.PriceKey;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * {@code ifc.set_property}: writes one typed property, on the piece or on its type ({@link PropertyScope}).
 * {@code priceKey} is optional: with it the estimate adds an extra cost line.
 */
public record SetProperty(String id, String element, PropertyScope scope, String pset, String property, PropertyValue value,
                          PriceKey priceKey) implements Operation {
    public static final String OP = "ifc.set_property";
    private static final Pattern NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,63}");

    public SetProperty {
        id = Operation.checkId(id);
        element = GlobalId.require(element);
        Objects.requireNonNull(scope, "scope");
        if (pset == null || !NAME.matcher(pset).matches()) throw new IllegalArgumentException("Nombre de conjunto inválido");
        if (property == null || !NAME.matcher(property).matches()) throw new IllegalArgumentException("Nombre de propiedad inválido");
        if (value == null) throw new IllegalArgumentException("El valor es obligatorio");
    }

    public String op() { return OP; }

    public SetProperty withId(String value) { return new SetProperty(value, element, scope, pset, property, this.value, priceKey); }

    public String target() { return OP + "|" + element + "|" + scope.wire() + "|" + pset + "|" + property; }
}
