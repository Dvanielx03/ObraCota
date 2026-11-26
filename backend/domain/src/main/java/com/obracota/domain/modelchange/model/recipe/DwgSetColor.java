package com.obracota.domain.modelchange.model.recipe;

/** {@code dwg.set_color}: AutoCAD colour index, 0 (BYBLOCK) to 256 (BYLAYER); 1 red, 2 yellow, 3 green, 5 blue… */
public record DwgSetColor(String id, String element, int color) implements DwgOperation {
    public static final String OP = "dwg.set_color";

    public DwgSetColor {
        id = Operation.checkId(id);
        element = DwgHandle.require(element);
        if (color < 0 || color > 256) throw new IllegalArgumentException("Color inválido: índice de AutoCAD de 0 a 256");
    }

    public String op() { return OP; }

    public DwgSetColor withId(String value) { return new DwgSetColor(value, element, color); }

    public String target() { return OP + "|" + element; }
}
