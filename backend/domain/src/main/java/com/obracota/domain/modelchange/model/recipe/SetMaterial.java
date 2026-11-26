package com.obracota.domain.modelchange.model.recipe;

import com.obracota.domain.modelchange.model.price.PriceKey;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * {@code ifc.set_material} (H2 material): gives every piece of {@code elements} the finish {@code material}, with its
 * {@code category} and an approximate {@code color} ({@code #rrggbb}) for other viewers. {@code element} is the first
 * piece, so every report that names one piece per operation keeps working.
 * for {@code item:<material>}; a missing price is shown as missing, never invented.
 */
public record SetMaterial(String id, List<String> elements, String material, String category, String color, PriceKey priceKey)
    implements Operation {
    public static final String OP = "ifc.set_material";
    public static final int PIECES_LIMIT = 500;
    public static final int MATERIAL_LIMIT = 60;
    public static final int CATEGORY_LIMIT = 40;
    private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{6}");
    private static final Pattern CONTROL = Pattern.compile("\\p{Cntrl}");

    public SetMaterial {
        id = Operation.checkId(id);
        if (elements == null || elements.isEmpty()) throw new IllegalArgumentException("La lista de piezas está vacía");
        if (elements.size() > PIECES_LIMIT) throw new IllegalArgumentException("Un acabado admite como máximo " + PIECES_LIMIT + " piezas");
        elements = List.copyOf(elements);
        elements.forEach(GlobalId::require);
        if (new HashSet<>(elements).size() != elements.size()) throw new IllegalArgumentException("Hay piezas repetidas en la lista");
        material = text(material, MATERIAL_LIMIT, "Nombre de material inválido");
        category = text(category, CATEGORY_LIMIT, "Categoría de material inválida");
        if (color == null || !COLOR.matcher(color).matches()) throw new IllegalArgumentException("Color inválido: usa #rrggbb");
    }

    private static String text(String value, int limit, String message) {
        if (value == null || value.isBlank() || value.length() > limit || CONTROL.matcher(value).find())
            throw new IllegalArgumentException(message);
        return value;
    }

    public String op() { return OP; }

    public String element() { return elements.getFirst(); }

    /** The key whose price the estimate uses: the one given, or {@code item:<material>}. */

    public SetMaterial withId(String value) { return new SetMaterial(value, elements, material, category, color, priceKey); }

    public String target() { return OP + "|" + String.join(",", elements.stream().sorted().toList()); }
}
