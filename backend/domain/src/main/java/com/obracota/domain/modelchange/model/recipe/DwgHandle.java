package com.obracota.domain.modelchange.model.recipe;

import java.util.regex.Pattern;

/**
 * Handle of an entity of a DWG drawing: 1 to 16 upper-case hexadecimal digits, the «Handle CAD» the viewer shows and
 * LibreDWG keeps when it writes the DXF of the drawing (group 5).
 */
public final class DwgHandle {
    private static final Pattern FORMAT = Pattern.compile("[0-9A-F]{1,16}");

    private DwgHandle() {}

    public static boolean valid(String value) { return value != null && FORMAT.matcher(value).matches(); }

    public static String require(String value) {
        if (!valid(value)) throw new IllegalArgumentException("Handle DWG inválido");
        return value;
    }
}
