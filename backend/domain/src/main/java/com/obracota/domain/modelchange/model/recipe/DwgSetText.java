package com.obracota.domain.modelchange.model.recipe;

/** {@code dwg.set_text}: the text of a TEXT, MTEXT, ATTRIB, multileader, or the text override of a dimension. */
public record DwgSetText(String id, String element, String text) implements DwgOperation {
    public static final String OP = "dwg.set_text";

    public DwgSetText {
        id = Operation.checkId(id);
        element = DwgHandle.require(element);
        text = DwgOperation.text(text, "Texto inválido: de 1 a " + TEXT_LIMIT + " caracteres en una línea");
    }

    public String op() { return OP; }

    public DwgSetText withId(String value) { return new DwgSetText(value, element, text); }

    public String target() { return OP + "|" + element; }
}
