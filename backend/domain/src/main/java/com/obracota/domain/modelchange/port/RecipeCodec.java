package com.obracota.domain.modelchange.port;

import com.obracota.domain.modelchange.model.recipe.Operation;
import com.obracota.domain.modelchange.model.recipe.Recipe;

/**
 * JSON form of {@code obracota.recipe/1} (§5.4), kept out of the domain. Malformed input makes the implementation throw
 * {@code InvalidRequestApplicationException("RECIPE_INVALID", message)}, never a bare {@link IllegalArgumentException}.
 */
public interface RecipeCodec {
    /** Reads a stored or received recipe. */
    Recipe recipe(String json);

    /** Reads one operation as a client sends it; its {@code id} may be absent. */
    Operation operation(String json);

    /**
     * The recipe as JSON with sorted keys and no spaces. It is what gets stored, and its SHA-256 tells whether a report
     * is still current. It is never compared with the engine's hash.
     */
    String canonical(Recipe recipe);
}
