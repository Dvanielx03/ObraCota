package com.obracota.infrastructure.modelchange.adapters.out.json;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.json.JsonReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.recipe.*;
import com.obracota.domain.modelchange.port.RecipeCodec;
import java.util.*;
import java.util.function.Supplier;

/**
 * {@code obracota.recipe/1} as JSON (§5.4). The JSON is read by hand into the domain records, which validate in their
 * constructors; their {@link IllegalArgumentException} becomes a 400 {@code RECIPE_INVALID} with its message. Unknown
 * fields are rejected, as the engine does. {@link #canonical} writes sorted keys, no spaces, plain decimals and an
 * explicit {@code price_key: null}, so the same recipe always hashes the same.
 */
public final class JacksonRecipeCodec implements RecipeCodec {
    static final String REMOVE = "ifc.remove_element";
    private static final Set<String> CHANGE_TYPE_FIELDS = Set.of("id", "op", "element", "type_id");
    private static final Set<String> SET_PROPERTY_FIELDS = Set.of("id", "op", "element", "scope", "pset", "property", "value", "price_key");
    private static final Set<String> SET_MATERIAL_FIELDS = Set.of("id", "op", "element", "elements", "material", "category", "color", "price_key");
    private static final Set<String> RECIPE_FIELDS = Set.of("format", "operations");
    private static final int JSON_LIMIT = 64 * 1024;

    private final ObjectMapper json = JsonMapper.builder()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .disable(JsonReadFeature.ALLOW_NON_NUMERIC_NUMBERS)
        .enable(JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN)
        .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
        .build();

    @Override
    public Recipe recipe(String text) {
        var root = parse(text);
        if (!root.isObject()) throw invalid("La receta tiene que ser un objeto JSON.");
        fields(root, RECIPE_FIELDS, "la receta");
        var format = root.get("format");
        if (format == null || !format.isTextual()) throw invalid("Falta el formato de la receta.");
        var list = root.get("operations");
        if (list == null || !list.isArray()) throw invalid("La receta necesita la lista operations.");
        var operations = new ArrayList<Operation>();
        int position = 1;
        for (var node : list) {
            var operation = operation(node, position++);
            if (operation.id() == null) throw invalid("Cada operación de la receta necesita su id.");
            operations.add(operation);
        }
        return guarded(() -> new Recipe(format.asText(), operations));
    }

    @Override
    public Operation operation(String text) { return operation(parse(text), 1); }

    @Override
    public String canonical(Recipe recipe) {
        try {
            return json.writeValueAsString(tree(recipe));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The recipe as a JSON-like tree with the wire names and sorted keys, as the engine receives it. */
    public Map<String, Object> tree(Recipe recipe) {
        var operations = new ArrayList<Map<String, Object>>();
        for (var operation : recipe.operations()) operations.add(tree(operation));
        var root = new TreeMap<String, Object>();
        root.put("format", recipe.format());
        root.put("operations", operations);
        return root;
    }

    private static Map<String, Object> tree(Operation operation) {
        var node = new TreeMap<String, Object>();
        node.put("id", operation.id());
        node.put("op", operation.op());
        node.put("element", operation.element());
        switch (operation) {
            case ChangeType change -> node.put("type_id", change.typeId());
            case SetProperty property -> {
                node.put("scope", property.scope().wire());
                node.put("pset", property.pset());
                node.put("property", property.property());
                node.put("value", property.value().raw());
                node.put("price_key", property.priceKey() == null ? null : property.priceKey().value());
            }
            case SetMaterial finish -> {
                node.put("elements", finish.elements());
                node.put("material", finish.material());
                node.put("category", finish.category());
                node.put("color", finish.color());
                node.put("price_key", finish.priceKey() == null ? null : finish.priceKey().value());
            }
        }
        return node;
    }

    private Operation operation(JsonNode node, int position) {
        if (node == null || !node.isObject()) throw invalid("La operación " + position + " tiene que ser un objeto JSON.");
        var op = node.get("op");
        if (op == null || !op.isTextual()) throw invalid("La operación " + position + " necesita op.");
        var id = optionalText(node, "id", position);
        return switch (op.asText()) {
            case ChangeType.OP -> {
                fields(node, CHANGE_TYPE_FIELDS, "la operación " + position);
                yield guarded(() -> new ChangeType(id, text(node, "element", position), text(node, "type_id", position)));
            }
            case SetProperty.OP -> {
                fields(node, SET_PROPERTY_FIELDS, "la operación " + position);
                var priceKey = optionalText(node, "price_key", position);
                yield guarded(() -> new SetProperty(id, text(node, "element", position), PropertyScope.of(text(node, "scope", position)),
                    text(node, "pset", position), text(node, "property", position), value(node.get("value"), position),
                    priceKey == null ? null : new PriceKey(priceKey)));
            }
            case SetMaterial.OP -> {
                fields(node, SET_MATERIAL_FIELDS, "la operación " + position);
                var priceKey = optionalText(node, "price_key", position);
                var elements = elements(node, position);
                var element = optionalText(node, "element", position);
                if (element != null && (elements.isEmpty() || !element.equals(elements.getFirst())))
                    throw invalid("En la operación " + position + ", element tiene que ser la primera pieza de elements.");
                yield guarded(() -> new SetMaterial(id, elements, text(node, "material", position), text(node, "category", position),
                    text(node, "color", position), priceKey == null ? null : new PriceKey(priceKey)));
            }
            case REMOVE -> throw new UnprocessableApplicationException("OPERATION_NOT_ENABLED", "Eliminar elementos llega en H5.");
            default -> throw invalid("La operación " + position + " no es una operación conocida.");
        };
    }

    /** Text, a JSON boolean or a finite number. {@code null}, lists and objects are rejected (§5.4, §5.10). */
    private static PropertyValue value(JsonNode node, int position) {
        if (node == null || node.isNull()) throw invalid("La operación " + position + " necesita un valor; null no se admite.");
        if (node.isTextual()) return new PropertyValue.Text(node.asText());
        if (node.isBoolean()) return new PropertyValue.Bool(node.asBoolean());
        if (node.isNumber()) return new PropertyValue.Number(node.decimalValue());
        throw invalid("El valor de la operación " + position + " es texto, un booleano o un número.");
    }

    private static List<String> elements(JsonNode node, int position) {
        var value = node.get("elements");
        if (value == null || !value.isArray()) throw invalid("Falta la lista elements en la operación " + position + ".");
        var list = new ArrayList<String>();
        for (var item : value) {
            if (!item.isTextual()) throw invalid("Cada pieza de elements es un GlobalId en la operación " + position + ".");
            list.add(item.asText());
        }
        return list;
    }

    private static String text(JsonNode node, String field, int position) {
        var value = node.get(field);
        if (value == null || !value.isTextual()) throw invalid("Falta " + field + " en la operación " + position + ".");
        return value.asText();
    }

    private static String optionalText(JsonNode node, String field, int position) {
        var value = node.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw invalid(field + " tiene que ser texto en la operación " + position + ".");
        return value.asText();
    }

    private static void fields(JsonNode node, Set<String> allowed, String where) {
        for (var names = node.fieldNames(); names.hasNext(); ) {
            var name = names.next();
            if (!allowed.contains(name)) throw invalid("Campo desconocido en " + where + ": " + name + ".");
        }
    }

    private JsonNode parse(String text) {
        if (text == null || text.isBlank()) throw invalid("Falta la receta.");
        if (text.length() > JSON_LIMIT) throw invalid("La receta es demasiado grande.");
        try {
            return json.readTree(text);
        } catch (JsonProcessingException e) {
            throw invalid("La receta no es JSON válido.");
        }
    }

    private static <T> T guarded(Supplier<T> build) {
        try {
            return build.get();
        } catch (IllegalArgumentException e) {
            var message = e.getMessage() == null ? "La receta no es válida" : e.getMessage();
            throw invalid(message.endsWith(".") ? message : message + ".");
        }
    }

    private static InvalidRequestApplicationException invalid(String message) {
        return new InvalidRequestApplicationException("RECIPE_INVALID", message);
    }
}
