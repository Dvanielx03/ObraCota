package com.obracota.domain.modelchange.model.recipe;

/** {@code dwg.add_note}: a note with a revision cloud around the entity, on layer OBRACOTA-REVISION. */
public record DwgAddNote(String id, String element, String text) implements DwgOperation {
    public static final String OP = "dwg.add_note";

    public DwgAddNote {
        id = Operation.checkId(id);
        element = DwgHandle.require(element);
        text = DwgOperation.text(text, "Nota inválida: de 1 a " + TEXT_LIMIT + " caracteres en una línea");
    }

    public String op() { return OP; }

    public DwgAddNote withId(String value) { return new DwgAddNote(value, element, text); }

    public String target() { return OP + "|" + element + "|" + text; }
}
