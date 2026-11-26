package com.obracota.infrastructure.modelchange;

import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.recipe.SetMaterial;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** H2 material: {@code ifc.set_material} is enabled, validated in its record and in the codec. */
class ModelChangeMaterialTest {
    static final String WALL_1 = "1hOSvn6df7F8_7GcBWlS8Z";
    static final String WALL_2 = "2klOFZffH6WQFlV10uM1wF";
    static final String WINDOW = "0000000000000000000003";
    final JacksonRecipeCodec codec = new JacksonRecipeCodec();

    static SetMaterial stone(PriceKey key, String... elements) {
        return new SetMaterial(null, List.of(elements), "Piedra · claro", "Piedra", "#cbbfa8", key);
    }

    @Test void theOperationIsEnabled() {
        assertTrue(ModelChanges.ENABLED_OPERATIONS.contains(SetMaterial.OP));
    }

    @Test void theRecordValidatesItsShape() {
        var finish = stone(null, WALL_1, WALL_2);
        assertEquals(WALL_1, finish.element());
        assertEquals(stone(null, WALL_2, WALL_1).target(), finish.target(), "the target does not depend on the order");
        assertThrows(IllegalArgumentException.class, () -> stone(null));
        assertThrows(IllegalArgumentException.class, () -> stone(null, WALL_1, WALL_1));
        assertThrows(IllegalArgumentException.class, () -> stone(null, "no-es-un-globalid"));
        assertThrows(IllegalArgumentException.class, () -> new SetMaterial(null, List.of(WALL_1), " ", "Piedra", "#cbbfa8", null));
        assertThrows(IllegalArgumentException.class, () -> new SetMaterial(null, List.of(WALL_1), "Piedra", "Piedra", "cbbfa8", null));
        assertThrows(IllegalArgumentException.class, () -> new SetMaterial(null, List.of(WALL_1), "x".repeat(61), "Piedra", "#cbbfa8", null));
        assertThrows(IllegalArgumentException.class, () -> new SetMaterial(null, List.of(WALL_1), "Piedra\nclaro", "Piedra", "#cbbfa8", null));
        var many = new ArrayList<String>();
        for (int index = 0; index <= SetMaterial.PIECES_LIMIT; index++) many.add(String.format("%022d", index));
        assertThrows(IllegalArgumentException.class, () -> stone(null, many.toArray(String[]::new)));
    }

    @Test void theCodecReadsAndWritesIt() {
        var text = "{\"op\":\"ifc.set_material\",\"element\":\"" + WALL_1 + "\",\"elements\":[\"" + WALL_1 + "\",\"" + WALL_2
            + "\"],\"material\":\"Piedra · claro\",\"category\":\"Piedra\",\"color\":\"#cbbfa8\"}";
        var operation = (SetMaterial) codec.operation(text);
        assertEquals(List.of(WALL_1, WALL_2), operation.elements());
        var recipe = Recipe.empty().append(operation);
        var canonical = codec.canonical(recipe);
        assertTrue(canonical.contains("\"elements\":[\"" + WALL_1 + "\",\"" + WALL_2 + "\"]"), canonical);
        assertTrue(canonical.contains("\"element\":\"" + WALL_1 + "\""), canonical);
        assertEquals(recipe, codec.recipe(canonical));
        for (var broken : List.of(
            text.replace("\"element\":\"" + WALL_1 + "\"", "\"element\":\"" + WALL_2 + "\""),
            text.replace("\"color\":\"#cbbfa8\"", "\"color\":\"rojo\""),
            text.replace("\"elements\":[", "\"elements\":[1,"),
            text.replace("}", ",\"scope\":\"type\"}"))) {
            assertEquals("RECIPE_INVALID", assertThrows(InvalidRequestApplicationException.class, () -> codec.operation(broken)).code(), broken);
        }
    }
}
