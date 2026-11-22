package com.obracota.infrastructure.modelchange;

import com.obracota.application.modelchange.rules.ChangeActions;
import com.obracota.application.modelchange.rules.ChangeEstimate;
import com.obracota.application.modelchange.rules.ChangeFindings;
import com.obracota.domain.modelchange.model.ChangeOrigin;
import com.obracota.domain.modelchange.model.ChangeStateException;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.*;
import com.obracota.domain.modelchange.model.report.EstimateLine;
import com.obracota.domain.modelchange.model.report.Finding;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.model.report.QuantityLine;
import com.obracota.domain.security.model.Actor;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** J13: invalid transitions throw {@link ChangeStateException}; estimate and door notices. Plain Java, no Spring. */
class ModelChangeRulesTest {
    static final String DOOR = "1hOSvn6df7F8_7GcBWlS8Z";
    static final String PROPOSED = "2klOFZffH6WQFlV10uM1wF";
    static final String CURRENT = "0000000000000000000001";
    static final UUID USER = UUID.randomUUID();
    static final Actor PERSON = Actor.person(USER);
    static final Instant NOW = Instant.parse("2026-11-21T15:00:00Z");

    static ModelChange draft(Actor actor) {
        var project = actor.person() ? UUID.randomUUID() : actor.project();
        return ModelChange.draft(UUID.randomUUID(), project, UUID.randomUUID(), UUID.randomUUID(), "IFC", actor, " Puerta alternativa ", NOW);
    }

    static Map<String, Object> inspected() {
        var before = new LinkedHashMap<String, Object>();
        before.put("element", DOOR);
        before.put("name", "Puerta 1");
        before.put("typeId", CURRENT);
        before.put("typeName", "P76");
        before.put("width", 0.762);
        before.put("height", 2.032);
        before.put("opening", "0000000000000000000009");
        before.put("openingSize", List.of(0.81, 2.06));
        before.put("host", "0000000000000000000008");
        before.put("loadBearing", null);
        before.put("options", List.of(Map.of("id", PROPOSED, "name", "P76B", "width", 0.762, "height", 2.032, "compatible", true)));
        return before;
    }

    static PreviewReport report(Recipe recipe, boolean ok) {
        var results = recipe.operations().stream().map(operation -> new PreviewReport.OperationResult(operation.id(), operation.op(), ok,
            operation.element(), ok ? List.of() : List.of(new PreviewReport.OperationError("TYPE_NOT_COMPATIBLE", "No cabe en el hueco.")),
            operation instanceof ChangeType ? inspected() : Map.of(), Map.of(), List.of())).toList();
        var engineNotice = new Finding("ASSIGN_TYPE_CLEARED_ATTRIBUTES", "WARNING", "ObjectType cambió.", "ifcopenshell", DOOR);
        return new PreviewReport(ok, "engine", ok ? new PreviewReport.Artifact("a1", "f".repeat(64), 10, NOW) : null, results,
            List.of(engineNotice), List.of(new QuantityLine(DOOR, "after", BigDecimal.ONE, "UNIT", "UNIT",
                "Puerta por unidad: ifc5d no mapea Qto_DoorBaseQuantities", true)), Map.of("diff", Map.of("changed", List.of())));
    }

    static Recipe recipe(Operation... operations) {
        var recipe = Recipe.empty();
        for (var operation : operations) recipe = recipe.append(operation);
        return recipe;
    }

    static final ModelChange.Preview FILE = new ModelChange.Preview(UUID.randomUUID(), "f".repeat(64), 10);

    /** A draft with one door operation and a current ok preview, then submitted. */
    static ModelChange ready(Actor actor) {
        var draft = draft(actor);
        var withOperation = draft.withRecipe(recipe(new ChangeType(null, DOOR, PROPOSED)), NOW);
        return withOperation.previewed(report(withOperation.recipe(), true), "h1", FILE, NOW).submitted("h1", null, NOW);
    }

    @Nested class Transitions {
        @Test void draftStartsEmptyAndRecordsItsOrigin() {
            var person = draft(PERSON);
            assertEquals(ChangeStatus.DRAFT, person.status());
            assertEquals(ChangeOrigin.PERSON, person.origin());
            assertTrue(person.recipe().isEmpty());
            assertEquals("Puerta alternativa", person.description());
            var run = UUID.randomUUID();
            var agent = draft(Actor.agent(USER, UUID.randomUUID(), run));
            assertEquals(ChangeOrigin.AGENT, agent.origin());
            assertEquals(run, agent.agentRun());
            assertThrows(IllegalArgumentException.class, () -> ModelChange.draft(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), "IFC", PERSON, " ", NOW));
        }

        @Test void recipeIsFrozenOutsideDraft() {
            var ready = ready(PERSON);
            assertThrows(ChangeStateException.class, () -> ready.withRecipe(Recipe.empty(), NOW));
            var applied = ready.applied(UUID.randomUUID(), USER, null, "h1", NOW);
            assertThrows(ChangeStateException.class, () -> applied.withRecipe(Recipe.empty(), NOW));
            var discarded = draft(PERSON).discarded(PERSON, NOW);
            assertThrows(ChangeStateException.class, () -> discarded.withRecipe(Recipe.empty(), NOW));
        }

        @Test void submitNeedsOperationsAndACurrentOkPreview() {
            var empty = draft(PERSON);
            assertThrows(ChangeStateException.class, () -> empty.submitted("h0", null, NOW));
            var draft = empty.withRecipe(recipe(new ChangeType(null, DOOR, PROPOSED)), NOW);
            assertThrows(ChangeStateException.class, () -> draft.submitted("h1", null, NOW), "no preview");
            var failed = draft.previewed(report(draft.recipe(), false), "h1", null, NOW);
            assertNull(failed.preview());
            assertThrows(ChangeStateException.class, () -> failed.submitted("h1", null, NOW), "ok=false");
            var previewed = draft.previewed(report(draft.recipe(), true), "h1", FILE, NOW);
            assertTrue(previewed.reportCurrent("h1"));
            assertFalse(previewed.reportCurrent("h2"));
            assertThrows(ChangeStateException.class, () -> previewed.submitted("h2", null, NOW), "stale report");
            var ready = previewed.submitted("h1", "  Resumen  ", NOW);
            assertEquals(ChangeStatus.READY, ready.status());
            assertEquals("Resumen", ready.summary());
            assertEquals(NOW, ready.submittedAt());
            assertThrows(ChangeStateException.class, () -> ready.submitted("h1", null, NOW), "already READY");
        }

        @Test void previewOfAReadyChangeKeepsItOnlyWhenOk() {
            var ready = ready(PERSON);
            var again = ready.previewed(report(ready.recipe(), true), "h1", FILE, NOW);
            assertEquals(ChangeStatus.READY, again.status());
            var failed = ready.previewed(report(ready.recipe(), false), "h1", null, NOW);
            assertEquals(ChangeStatus.DRAFT, failed.status());
            assertNull(failed.preview());
            assertNull(failed.submittedAt());
            assertThrows(IllegalArgumentException.class, () -> ready.previewed(report(ready.recipe(), true), "h1", null, NOW),
                "an ok preview comes with its file");
        }

        @Test void applyAndRestoreFollowTheirOrder() {
            var draft = draft(PERSON);
            var refused = assertThrows(ChangeStateException.class, () -> draft.applied(UUID.randomUUID(), USER, null, "h0", NOW));
            assertEquals("Previsualiza el cambio para aprobarlo.", refused.getMessage());
            var notApplied = assertThrows(ChangeStateException.class, () -> ready(PERSON).restored(UUID.randomUUID(), USER, NOW));
            assertEquals("Todavía no se aplicó el cambio.", notApplied.getMessage());
            var ready = ready(PERSON);
            assertThrows(ChangeStateException.class, () -> ready.applied(UUID.randomUUID(), USER, null, "other", NOW), "stale report");
            var version = UUID.randomUUID();
            var applied = ready.applied(version, USER, null, "h1", NOW);
            assertEquals(ChangeStatus.APPLIED, applied.status());
            assertEquals(version, applied.applied().version());
            assertNull(applied.preview(), "the preview file is gone once published");
            assertThrows(ChangeStateException.class, () -> applied.applied(UUID.randomUUID(), USER, null, "h1", NOW));
            var restored = applied.restored(UUID.randomUUID(), USER, NOW);
            assertEquals(ChangeStatus.RESTORED, restored.status());
            assertThrows(ChangeStateException.class, () -> restored.restored(UUID.randomUUID(), USER, NOW));
            assertThrows(ChangeStateException.class, () -> restored.previewed(report(restored.recipe(), true), "h1", FILE, NOW));
        }

        @Test void discardOnlyWhilePendingAndRecordsWho() {
            var applied = ready(PERSON).applied(UUID.randomUUID(), USER, null, "h1", NOW);
            var refused = assertThrows(ChangeStateException.class, () -> applied.discarded(PERSON, NOW));
            assertEquals("Un cambio aplicado se revierte con una revisión de restauración.", refused.getMessage());
            var agent = Actor.agent(USER, UUID.randomUUID(), UUID.randomUUID());
            var discarded = ready(agent).discarded(agent, NOW);
            assertEquals(ChangeStatus.DISCARDED, discarded.status());
            assertEquals(Actor.Kind.AGENT, discarded.discarded().kind());
            assertNull(discarded.preview());
            assertThrows(ChangeStateException.class, () -> discarded.discarded(PERSON, NOW));
            assertThrows(ChangeStateException.class, () -> discarded.previewed(report(discarded.recipe(), false), "h1", null, NOW));
        }

        @Test void agentOnlyTouchesItsOwnRun() {
            var project = UUID.randomUUID();
            var run = UUID.randomUUID();
            var agent = Actor.agent(USER, project, run);
            var own = draft(agent);
            assertTrue(own.touchableBy(agent));
            assertTrue(own.touchableBy(PERSON));
            assertFalse(own.touchableBy(Actor.agent(USER, project, UUID.randomUUID())), "another run");
            assertFalse(draft(PERSON).touchableBy(agent), "a change of the person");
        }
    }

    @Nested class RecipeShape {
        @Test void idsAreMaxPlusOneAndTargetsUnique() {
            var recipe = recipe(new ChangeType(null, DOOR, PROPOSED),
                new SetProperty(null, DOOR, PropertyScope.OCCURRENCE, "Pset_DoorCommon", "FireRating", new PropertyValue.Text("EI 60"), null));
            assertEquals(List.of("op-1", "op-2"), recipe.operations().stream().map(Operation::id).toList());
            assertEquals("op-3", recipe.nextId());
            assertEquals("op-3", recipe.remove("op-1").nextId(), "the largest number in use is still 2");
            assertEquals("op-2", recipe.remove("op-2").nextId());
            assertEquals("op-1", Recipe.empty().nextId());
            var duplicate = new ChangeType(null, DOOR, CURRENT);
            assertTrue(recipe.conflict(duplicate, null).isPresent());
            assertTrue(recipe.conflict(duplicate, "op-1").isEmpty(), "replacing op-1 itself");
            assertThrows(IllegalArgumentException.class, () -> recipe.append(duplicate));
            var replaced = recipe.replace("op-1", duplicate);
            assertEquals("op-1", replaced.operations().getFirst().id());
            assertEquals(CURRENT, ((ChangeType) replaced.operations().getFirst()).typeId());
        }

        @Test void limitsAndShapesAreChecked() {
            var many = new ArrayList<Operation>();
            for (int index = 1; index <= Recipe.LIMIT + 1; index++) many.add(new ChangeType("op-" + index, "%022d".formatted(index), PROPOSED));
            assertThrows(IllegalArgumentException.class, () -> new Recipe(Recipe.FORMAT, many));
            assertThrows(IllegalArgumentException.class, () -> new Recipe("obracota.recipe/2", List.of()));
            assertThrows(IllegalArgumentException.class, () -> new ChangeType(null, "corto", PROPOSED));
            assertThrows(IllegalArgumentException.class, () -> new ChangeType("op-x", DOOR, PROPOSED));
            assertThrows(IllegalArgumentException.class, () -> new SetProperty(null, DOOR, PropertyScope.TYPE, "Pset_DoorCommon", "FireRating", null, null));
            assertThrows(IllegalArgumentException.class, () -> new SetProperty(null, DOOR, PropertyScope.TYPE, "1Pset", "FireRating",
                new PropertyValue.Bool(true), null));
            assertThrows(IllegalArgumentException.class, () -> new PropertyValue.Text("línea\nnueva"));
            assertThrows(IllegalArgumentException.class, () -> new PropertyValue.Text(""));
            assertThrows(IllegalArgumentException.class, () -> new PropertyValue.Text("x".repeat(256)));
            assertEquals(PropertyScope.TYPE, PropertyScope.of("type"));
            assertThrows(IllegalArgumentException.class, () -> PropertyScope.of("TYPE"));
        }

        @Test void priceKeysAndPricesAreValidated() {
            assertTrue(PriceKey.type(PROPOSED).isType());
            assertEquals(Optional.of(PROPOSED), PriceKey.type(PROPOSED).typeId());
            assertEquals("item:Sello cortafuego", PriceKey.item("Sello cortafuego").value());
            assertThrows(IllegalArgumentException.class, () -> new PriceKey("type:corto"));
            assertThrows(IllegalArgumentException.class, () -> new PriceKey("item:"));
            assertThrows(IllegalArgumentException.class, () -> new PriceKey("item:con\ttab"));
            assertThrows(IllegalArgumentException.class, () -> price(PROPOSED, "-1"));
            assertThrows(IllegalArgumentException.class, () -> price(PROPOSED, "1.001"));
            assertThrows(IllegalArgumentException.class, () -> new UnitPrice(PriceKey.type(PROPOSED), UnitPrice.Unit.UNIT, "COP",
                BigDecimal.TEN, " ", LocalDate.now(), null));
            assertEquals("Cotización", new UnitPrice(PriceKey.type(PROPOSED), UnitPrice.Unit.UNIT, "COP", BigDecimal.TEN, " Cotización ",
                LocalDate.now(), null).source());
        }
    }

    static UnitPrice price(String type, String amount) {
        return new UnitPrice(PriceKey.type(type), UnitPrice.Unit.UNIT, "COP", new BigDecimal(amount), "Cotización de prueba",
            LocalDate.parse("2026-11-20"), null);
    }

    @Nested class Estimates {
        @Test void typeChangeIsProposedMinusCurrent() {
            var recipe = recipe(new ChangeType(null, DOOR, PROPOSED));
            var estimate = ChangeEstimate.of(recipe, report(recipe, true), List.of(price(CURRENT, "100000"), price(PROPOSED, "125000")));
            var line = estimate.lines().getFirst();
            assertEquals(EstimateLine.Kind.TYPE_CHANGE, line.kind());
            assertEquals(PriceKey.type(CURRENT), line.beforeKey());
            assertEquals(0, new BigDecimal("25000").compareTo(line.difference()));
            assertEquals(0, new BigDecimal("25000").compareTo(estimate.total()));
            assertTrue(estimate.complete());
            assertEquals("COP", estimate.currency());
            assertEquals("Puerta por unidad: ifc5d no mapea Qto_DoorBaseQuantities", line.basis());
            assertEquals("Cotización de prueba", line.after().source());
        }

        @Test void aMissingPriceLeavesTheDifferenceEmpty() {
            var recipe = recipe(new ChangeType(null, DOOR, PROPOSED));
            var estimate = ChangeEstimate.of(recipe, report(recipe, true), List.of(price(CURRENT, "100000")));
            assertNull(estimate.lines().getFirst().difference());
            assertFalse(estimate.complete());
            assertEquals(0, BigDecimal.ZERO.compareTo(estimate.total()));
            var unreported = ChangeEstimate.of(recipe, null, List.of(price(CURRENT, "100000"), price(PROPOSED, "125000")));
            assertNull(unreported.lines().getFirst().beforeKey(), "without a report the current type is unknown");
            assertNull(unreported.lines().getFirst().difference());
        }

        @Test void aPriceInAnotherUnitIsShownButNotUsed() {
            var recipe = recipe(new ChangeType(null, DOOR, PROPOSED));
            var perArea = new UnitPrice(PriceKey.type(PROPOSED), UnitPrice.Unit.M2, "COP", new BigDecimal("125000"), "Cotización",
                LocalDate.parse("2026-11-20"), null);
            var line = ChangeEstimate.of(recipe, report(recipe, true), List.of(price(CURRENT, "100000"), perArea)).lines().getFirst();
            assertEquals(perArea, line.after());
            assertNull(line.difference());
        }

        @Test void propertiesCostOnlyWithAPriceKey() {
            var key = PriceKey.item("Sello cortafuego EI 60");
            var recipe = recipe(
                new SetProperty(null, DOOR, PropertyScope.OCCURRENCE, "Pset_DoorCommon", "FireRating", new PropertyValue.Text("EI 60"), key),
                new SetProperty(null, DOOR, PropertyScope.OCCURRENCE, "Pset_DoorCommon", "AcousticRating", new PropertyValue.Text("R30"), null));
            var extra = new UnitPrice(key, UnitPrice.Unit.UNIT, "COP", new BigDecimal("40000.50"), "Proveedor", LocalDate.parse("2026-11-19"), null);
            var estimate = ChangeEstimate.of(recipe, null, List.of(extra));
            assertEquals(1, estimate.lines().size(), "no line without price_key");
            assertEquals(EstimateLine.Kind.ADDITIONAL_COST, estimate.lines().getFirst().kind());
            assertEquals(0, new BigDecimal("40000.50").compareTo(estimate.total()));
            assertTrue(ChangeEstimate.of(recipe(new SetProperty(null, DOOR, PropertyScope.TYPE, "Pset_DoorCommon", "FireRating",
                new PropertyValue.Text("EI 60"), null)), null, List.of()).lines().isEmpty());
        }
    }

    @Nested class DoorNotices {
        @Test void doorRulesFollowTheEngineNotices() {
            var recipe = recipe(new ChangeType(null, DOOR, PROPOSED));
            var report = ChangeFindings.withDoorRules(recipe, report(recipe, true), new BigDecimal("0.8"));
            var rules = report.findings().stream().map(Finding::rule).toList();
            assertEquals(List.of("ASSIGN_TYPE_CLEARED_ATTRIBUTES", "HOST_LOAD_BEARING", "OPENING_SIZE", "MINIMUM_NOMINAL_WIDTH"), rules);
            var statuses = report.findings().stream().map(Finding::status).toList();
            assertEquals(List.of("WARNING", "UNKNOWN", "OK", "WARNING"), statuses, "unknown bearing, fits, below 0.8 m");
            assertTrue(report.findings().get(2).explanation().contains("0.81 × 2.06"));
        }

        @Test void noNoticesWithoutTheDoorOfThatOperation() {
            var recipe = recipe(new ChangeType(null, DOOR, PROPOSED));
            var other = recipe(new ChangeType(null, "0000000000000000000007", PROPOSED));
            assertEquals(1, ChangeFindings.withDoorRules(other, report(recipe, true), null).findings().size(), "another element");
            var empty = new PreviewReport(false, "engine", null, List.of(new PreviewReport.OperationResult("op-1", ChangeType.OP, false, DOOR,
                List.of(new PreviewReport.OperationError("NOT_A_DOOR", "No es una puerta.")), Map.of(), Map.of(), List.of())),
                List.of(), List.of(), Map.of());
            assertTrue(ChangeFindings.withDoorRules(recipe, empty, null).findings().isEmpty());
        }
    }

    @Nested class Actions {
        static ChangeActions.Facts facts(boolean baseLatest, int latest) {
            return new ChangeActions.Facts(baseLatest, latest, false, false, true, true);
        }

        static void everyRefusalExplainsItself(ChangeActions actions) {
            var allowed = Map.of("edit", actions.edit(), "preview", actions.preview(), "submit", actions.submit(),
                "apply", actions.apply(), "restore", actions.restore(), "discard", actions.discard());
            allowed.forEach((action, ok) -> {
                assertEquals(!ok, actions.reasons().containsKey(action), action);
                if (!ok) assertTrue(actions.reasons().get(action).startsWith("Pendiente: "), action);
            });
        }

        @Test void readyChangeOfThePerson() {
            var actions = ChangeActions.of(PERSON, ready(PERSON), facts(true, 1));
            assertFalse(actions.edit());
            assertTrue(actions.preview());
            assertFalse(actions.submit());
            assertEquals("Pendiente: el cambio ya está listo para aprobar", actions.reasons().get("submit"));
            assertTrue(actions.apply());
            assertFalse(actions.restore());
            assertTrue(actions.discard());
            everyRefusalExplainsItself(actions);
        }

        @Test void theAgentNeverPublishes() {
            var agent = Actor.agent(USER, UUID.randomUUID(), UUID.randomUUID());
            var own = ChangeActions.of(agent, ready(agent), facts(true, 1));
            assertFalse(own.apply());
            assertEquals("Pendiente: publicar y restaurar exigen la sesión de la propietaria", own.reasons().get("apply"));
            assertTrue(own.discard());
            var foreign = ChangeActions.of(agent, ready(PERSON), facts(true, 1));
            assertFalse(foreign.discard());
            assertFalse(foreign.preview());
            everyRefusalExplainsItself(own);
            everyRefusalExplainsItself(foreign);
        }

        @Test void aStaleBaseOnlyLetsItBeDiscarded() {
            var draft = draft(PERSON).withRecipe(recipe(new ChangeType(null, DOOR, PROPOSED)), NOW);
            var actions = ChangeActions.of(PERSON, draft, facts(false, 2));
            assertFalse(actions.edit());
            assertFalse(actions.preview());
            assertFalse(actions.submit());
            assertFalse(actions.apply());
            assertTrue(actions.discard());
            assertEquals("Pendiente: la base ya no es la última revisión; descarta este cambio o propón uno nuevo sobre v2",
                actions.reasons().get("preview"));
            everyRefusalExplainsItself(actions);
            var stale = ChangeActions.of(PERSON, ready(PERSON), facts(false, 2));
            assertFalse(stale.apply());
            assertTrue(stale.reasons().get("apply").contains("v2"));
        }

        @Test void aDraftWithoutPreviewCannotBeSubmitted() {
            var draft = draft(PERSON).withRecipe(recipe(new ChangeType(null, DOOR, PROPOSED)), NOW);
            var actions = ChangeActions.of(PERSON, draft, new ChangeActions.Facts(true, 1, false, false, false, false));
            assertTrue(actions.edit());
            assertFalse(actions.submit());
            assertEquals("Pendiente: previsualiza el cambio para enviarlo", actions.reasons().get("submit"));
            everyRefusalExplainsItself(actions);
        }

        @Test void restoreOnlyUndoesTheLatestRevision() {
            var applied = ready(PERSON).applied(UUID.randomUUID(), USER, null, "h1", NOW);
            var latest = ChangeActions.of(PERSON, applied, new ChangeActions.Facts(true, 2, true, true, true, false));
            assertTrue(latest.restore());
            var later = ChangeActions.of(PERSON, applied, new ChangeActions.Facts(false, 3, true, false, true, false));
            assertFalse(later.restore());
            assertEquals("Pendiente: hay una revisión posterior (v3); restaurar solo deshace la última", later.reasons().get("restore"));
            everyRefusalExplainsItself(latest);
            everyRefusalExplainsItself(later);
        }
    }
}
