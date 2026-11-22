package com.obracota.domain.modelchange.model.recipe;

import java.util.regex.Pattern;

/**
 * One typed step of a recipe. Every record validates its own shape in the constructor and throws
 * {@link IllegalArgumentException}; the engine decides later whether the model accepts it.
 */
public sealed interface Operation permits ChangeType, SetProperty {
    Pattern ID = Pattern.compile("op-[0-9]{1,3}");

    /** Stable id inside the recipe ({@code op-1}, {@code op-2}…); {@code null} until the server assigns it. */
    String id();

    /** Wire name, for example {@code ifc.change_type}. */
    String op();

    /** GlobalId of the element the operation targets. */
    String element();

    Operation withId(String id);

    /** What the operation changes. Two operations with the same target cannot share a recipe ({@code DUPLICATE_TARGET}). */
    String target();

    static String checkId(String id) {
        if (id != null && !ID.matcher(id).matches()) throw new IllegalArgumentException("Identificador de operación inválido");
        return id;
    }
}
