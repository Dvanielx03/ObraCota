package com.obracota.domain.modelchange.model.recipe;

import java.util.regex.Pattern;

/** IFC GlobalId: exactly 22 characters of {@code [0-9A-Za-z_$]}, the same rule the door routes apply today. */
public final class GlobalId {
    private static final Pattern FORMAT = Pattern.compile("[0-9A-Za-z_$]{22}");

    private GlobalId() {}

    public static boolean valid(String value) { return value != null && FORMAT.matcher(value).matches(); }

    public static String require(String value) {
        if (!valid(value)) throw new IllegalArgumentException("GlobalId inválido");
        return value;
    }
}
