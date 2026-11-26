package com.obracota.domain.modelchange.model.recipe;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * An operation of a DWG drawing ({@code dwg.*}): {@code element} is the handle of the entity ({@link DwgHandle}). The
 * engine applies them on the DXF of the drawing and the revision is published as a DXF. A recipe is either all
 * {@code ifc.*} or all {@code dwg.*}.
 */
public sealed interface DwgOperation extends Operation permits DwgSetText, DwgSetLayer, DwgSetColor, DwgMove, DwgAddNote {
    int TEXT_LIMIT = 255;
    Set<String> OPS = Set.of(DwgSetText.OP, DwgSetLayer.OP, DwgSetColor.OP, DwgMove.OP, DwgAddNote.OP);
    Pattern CONTROL = Pattern.compile("\\p{Cntrl}");

    static String text(String value, String message) {
        if (value == null || value.isBlank() || value.length() > TEXT_LIMIT || CONTROL.matcher(value).find())
            throw new IllegalArgumentException(message);
        return value;
    }

    static boolean drawing(String op) { return OPS.contains(op); }
}
