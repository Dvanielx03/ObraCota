package com.obracota.infrastructure.modelchange;

import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.modelchange.rules.ChangeEstimate;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.recipe.SetMaterial;
import com.obracota.domain.modelchange.model.report.EstimateLine;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.model.report.QuantityLine;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** H2 material: {@code ifc.set_material} is enabled, validated in its record and in the codec, and priced per m². */
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
        assertEquals(PriceKey.item("Piedra · claro"), finish.effectivePriceKey());
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

    static PreviewReport report(Recipe recipe) {
        var results = recipe.operations().stream().map(operation -> new PreviewReport.OperationResult(operation.id(), operation.op(), true,
            operation.element(), List.of(), Map.of(), Map.of(), List.of())).toList();
        return new PreviewReport(true, "engine", new PreviewReport.Artifact("a1", "f".repeat(64), 10, Instant.now()), results, List.of(),
            List.of(new QuantityLine(WALL_1, "before", new BigDecimal("10.5"), "M2", "QTO", "NetSideArea", true),
                new QuantityLine(WALL_1, "after", new BigDecimal("10.5"), "M2", "QTO", "NetSideArea", true),
                new QuantityLine(WALL_2, "after", new BigDecimal("4.25"), "M2", "QTO", "NetSideArea", true),
                new QuantityLine(WINDOW, "after", BigDecimal.ONE, "UNIT", "UNIT", "Ventana por unidad", true)),
            Map.of());
    }

    @Test void theEstimateUsesTheAreaAndAPricePerSquareMetre() {
        var recipe = Recipe.empty().append(stone(null, WALL_1, WALL_2, WINDOW));
        var key = PriceKey.item("Piedra · claro");
        var perArea = new UnitPrice(key, UnitPrice.Unit.M2, "COP", new BigDecimal("80000"), "Cotización", LocalDate.parse("2026-11-20"), null);
        var line = ChangeEstimate.of(recipe, report(recipe), List.of(perArea)).lines().getFirst();
        assertEquals(EstimateLine.Kind.MATERIAL_FINISH, line.kind());
        assertEquals(0, new BigDecimal("14.75").compareTo(line.quantity()), "only the after m² of the listed pieces");
        assertEquals(0, new BigDecimal("1180000").compareTo(line.difference()));
        assertTrue(line.basis().contains("2 de 3 piezas"), line.basis());

        var missing = ChangeEstimate.of(recipe, report(recipe), List.of());
        assertNull(missing.lines().getFirst().difference(), "no price, no invented cost");
        assertEquals(key, missing.lines().getFirst().afterKey());
        assertFalse(missing.complete());

        var perUnit = new UnitPrice(key, UnitPrice.Unit.UNIT, "COP", new BigDecimal("80000"), "Cotización", LocalDate.parse("2026-11-20"), null);
        assertNull(ChangeEstimate.of(recipe, report(recipe), List.of(perUnit)).lines().getFirst().difference());
        assertNull(ChangeEstimate.of(recipe, null, List.of(perArea)).lines().getFirst().quantity(), "not previewed yet");
    }
}
