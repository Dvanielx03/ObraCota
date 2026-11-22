package com.obracota.infrastructure.modelchange.adapters.out.json;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.report.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/**
 * JSON form of {@link PreviewReport} and {@link Estimate}. The report keeps the engine's wire names (§5.6): what the
 * engine sent plus the backend's notices, which is also what {@code model_change.report} stores. Reading is strict on
 * the typed sections ({@code ok}, {@code recipe_sha256}, {@code artifact}, {@code operations}, {@code findings},
 * {@code quantities}) and keeps the other sections verbatim in {@code details}. Anything that does not fit throws
 * {@link IllegalArgumentException}; the engine adapter turns it into a 502.
 */
public final class ReportJson {
    private static final Set<String> TYPED = Set.of("ok", "recipe_sha256", "artifact", "operations", "findings", "quantities");
    private static final TypeReference<LinkedHashMap<String, Object>> TREE = new TypeReference<>() {};

    private final ObjectMapper json = JsonMapper.builder()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .enable(JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN)
        .build();

    /** A JSON object as a JSON-like tree ({@code Map}, {@code List}, {@code String}, {@code Number}, {@code Boolean}, {@code null}). */
    public Map<String, Object> tree(byte[] body) {
        try {
            var value = json.readValue(body, TREE);
            if (value == null) throw new IllegalArgumentException("Expected a JSON object");
            return value;
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Not a JSON object", e);
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("Unreadable JSON", e);
        }
    }

    public String write(Object tree) {
        try {
            return json.writeValueAsString(tree);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    // Report ---------------------------------------------------------------------------------------------------------

    public PreviewReport report(String text) { return report(tree(text.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }

    public PreviewReport report(Map<String, Object> tree) {
        var ok = bool(tree.get("ok"), "ok");
        var artifact = tree.get("artifact") instanceof Map<?, ?> found ? artifact(map(found, "artifact")) : null;
        var operations = new ArrayList<PreviewReport.OperationResult>();
        for (var item : list(tree.get("operations"), "operations")) operations.add(operation(map(item, "operations[]")));
        var details = new LinkedHashMap<String, Object>();
        tree.forEach((key, value) -> { if (!TYPED.contains(key)) details.put(key, value); });
        return new PreviewReport(ok, optionalText(tree.get("recipe_sha256"), "recipe_sha256"), ok ? artifact : null, operations,
            findings(tree.get("findings")), quantities(tree.get("quantities")), details);
    }

    /** {@code {"ok", "operations": [{"id", "op", "ok", "element", "errors"}]}} of {@code checks_only}. */
    public List<PreviewReport.OperationResult> checks(Map<String, Object> tree) {
        var operations = new ArrayList<PreviewReport.OperationResult>();
        for (var item : list(tree.get("operations"), "operations")) operations.add(operation(map(item, "operations[]")));
        return operations;
    }

    public String write(PreviewReport report) { return write(tree(report)); }

    public Map<String, Object> tree(PreviewReport report) {
        var root = new LinkedHashMap<String, Object>();
        root.put("ok", report.ok());
        root.put("recipe_sha256", report.recipeSha256());
        if (report.artifact() != null) {
            var artifact = new LinkedHashMap<String, Object>();
            artifact.put("id", report.artifact().id());
            artifact.put("sha256", report.artifact().sha256());
            artifact.put("size", report.artifact().size());
            artifact.put("expires_at", report.artifact().expiresAt() == null ? null : report.artifact().expiresAt().toString());
            root.put("artifact", artifact);
        }
        var operations = new ArrayList<Map<String, Object>>();
        for (var result : report.operations()) {
            var node = new LinkedHashMap<String, Object>();
            node.put("id", result.id());
            node.put("op", result.op());
            node.put("ok", result.ok());
            node.put("element", result.element());
            node.put("errors", result.errors().stream().map(error -> {
                var item = new LinkedHashMap<String, Object>();
                item.put("code", error.code());
                item.put("detail", error.detail());
                return item;
            }).toList());
            node.put("before", result.before());
            node.put("after", result.after());
            node.put("findings", result.findings().stream().map(ReportJson::finding).toList());
            operations.add(node);
        }
        root.put("operations", operations);
        root.put("findings", report.findings().stream().map(ReportJson::finding).toList());
        root.put("quantities", report.quantities().stream().map(line -> {
            var node = new LinkedHashMap<String, Object>();
            node.put("element", line.element());
            node.put("phase", line.phase());
            node.put("quantity", line.quantity());
            node.put("unit", line.unit());
            node.put("source", line.source());
            node.put("basis", line.basis());
            node.put("reliable", line.reliable());
            return node;
        }).toList());
        report.details().forEach(root::putIfAbsent);
        return root;
    }

    private static Map<String, Object> finding(Finding finding) {
        var node = new LinkedHashMap<String, Object>();
        node.put("rule", finding.rule());
        node.put("status", finding.status());
        node.put("explanation", finding.explanation());
        node.put("source", finding.source());
        node.put("element", finding.element());
        return node;
    }

    private static PreviewReport.Artifact artifact(Map<String, Object> node) {
        var expires = optionalText(node.get("expires_at"), "artifact.expires_at");
        return new PreviewReport.Artifact(text(node.get("id"), "artifact.id"), text(node.get("sha256"), "artifact.sha256"),
            number(node.get("size"), "artifact.size").longValueExact(), expires == null ? null : Instant.parse(expires));
    }

    private static PreviewReport.OperationResult operation(Map<String, Object> node) {
        var errors = new ArrayList<PreviewReport.OperationError>();
        for (var item : list(node.get("errors"), "errors")) {
            var error = map(item, "errors[]");
            errors.add(new PreviewReport.OperationError(text(error.get("code"), "errors[].code"), optionalText(error.get("detail"), "errors[].detail")));
        }
        return new PreviewReport.OperationResult(optionalText(node.get("id"), "operations[].id"), optionalText(node.get("op"), "operations[].op"),
            bool(node.get("ok"), "operations[].ok"), optionalText(node.get("element"), "operations[].element"), errors,
            optionalMap(node.get("before"), "before"), optionalMap(node.get("after"), "after"), findings(node.get("findings")));
    }

    private static List<Finding> findings(Object value) {
        var findings = new ArrayList<Finding>();
        for (var item : list(value, "findings")) {
            var node = map(item, "findings[]");
            findings.add(new Finding(text(node.get("rule"), "findings[].rule"), text(node.get("status"), "findings[].status"),
                optionalText(node.get("explanation"), "findings[].explanation"), optionalText(node.get("source"), "findings[].source"),
                optionalText(node.get("element"), "findings[].element")));
        }
        return findings;
    }

    private static List<QuantityLine> quantities(Object value) {
        var lines = new ArrayList<QuantityLine>();
        for (var item : list(value, "quantities")) {
            var node = map(item, "quantities[]");
            var quantity = node.get("quantity") == null ? null : number(node.get("quantity"), "quantities[].quantity");
            lines.add(new QuantityLine(optionalText(node.get("element"), "quantities[].element"), optionalText(node.get("phase"), "quantities[].phase"),
                quantity, optionalText(node.get("unit"), "quantities[].unit"), optionalText(node.get("source"), "quantities[].source"),
                optionalText(node.get("basis"), "quantities[].basis"), node.get("reliable") == null || bool(node.get("reliable"), "quantities[].reliable")));
        }
        return lines;
    }

    // Estimate -------------------------------------------------------------------------------------------------------

    public String write(Estimate estimate) { return write(tree(estimate)); }

    /** The estimate as a JSON-like tree: what {@code approved_estimate} stores and what the API returns. */
    public Map<String, Object> tree(Estimate estimate) {
        var root = new LinkedHashMap<String, Object>();
        root.put("currency", estimate.currency());
        root.put("total", estimate.total());
        root.put("complete", estimate.complete());
        root.put("lines", estimate.lines().stream().map(line -> {
            var node = new LinkedHashMap<String, Object>();
            node.put("operation", line.operation());
            node.put("kind", line.kind().name());
            node.put("element", line.element());
            node.put("quantity", line.quantity());
            node.put("unit", line.unit() == null ? null : line.unit().name());
            node.put("quantitySource", line.quantitySource());
            node.put("basis", line.basis());
            node.put("beforeKey", line.beforeKey() == null ? null : line.beforeKey().value());
            node.put("before", price(line.before()));
            node.put("afterKey", line.afterKey() == null ? null : line.afterKey().value());
            node.put("after", price(line.after()));
            node.put("difference", line.difference());
            return node;
        }).toList());
        return root;
    }

    public Estimate estimate(String text) {
        var root = tree(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var lines = new ArrayList<EstimateLine>();
        for (var item : list(root.get("lines"), "lines")) {
            var node = map(item, "lines[]");
            var unit = optionalText(node.get("unit"), "unit");
            var beforeKey = optionalText(node.get("beforeKey"), "beforeKey");
            var afterKey = optionalText(node.get("afterKey"), "afterKey");
            lines.add(new EstimateLine(optionalText(node.get("operation"), "operation"),
                EstimateLine.Kind.valueOf(text(node.get("kind"), "kind")), optionalText(node.get("element"), "element"),
                node.get("quantity") == null ? null : number(node.get("quantity"), "quantity"),
                unit == null ? null : UnitPrice.Unit.valueOf(unit), optionalText(node.get("quantitySource"), "quantitySource"),
                optionalText(node.get("basis"), "basis"), beforeKey == null ? null : new PriceKey(beforeKey), price(node.get("before")),
                afterKey == null ? null : new PriceKey(afterKey), price(node.get("after")),
                node.get("difference") == null ? null : number(node.get("difference"), "difference")));
        }
        return new Estimate(text(root.get("currency"), "currency"), lines, number(root.get("total"), "total"), bool(root.get("complete"), "complete"));
    }

    private static Map<String, Object> price(UnitPrice price) {
        if (price == null) return null;
        var node = new LinkedHashMap<String, Object>();
        node.put("key", price.key().value());
        node.put("unit", price.unit().name());
        node.put("currency", price.currency());
        node.put("amount", price.amount());
        node.put("source", price.source());
        node.put("date", price.date().toString());
        node.put("copiedFrom", price.copiedFrom() == null ? null : price.copiedFrom().toString());
        return node;
    }

    private static UnitPrice price(Object value) {
        if (value == null) return null;
        var node = map(value, "price");
        var copied = optionalText(node.get("copiedFrom"), "copiedFrom");
        return new UnitPrice(new PriceKey(text(node.get("key"), "key")), UnitPrice.Unit.valueOf(text(node.get("unit"), "unit")),
            text(node.get("currency"), "currency"), number(node.get("amount"), "amount"), text(node.get("source"), "source"),
            LocalDate.parse(text(node.get("date"), "date")), copied == null ? null : UUID.fromString(copied));
    }

    // Tree access ----------------------------------------------------------------------------------------------------

    private static boolean bool(Object value, String field) {
        if (value instanceof Boolean flag) return flag;
        throw new IllegalArgumentException(field + " is not a boolean");
    }

    private static String text(Object value, String field) {
        if (value instanceof String text) return text;
        throw new IllegalArgumentException(field + " is not text");
    }

    private static String optionalText(Object value, String field) { return value == null ? null : text(value, field); }

    private static BigDecimal number(Object value, String field) {
        return switch (value) {
            case BigDecimal decimal -> decimal;
            case Integer number -> BigDecimal.valueOf(number);
            case Long number -> BigDecimal.valueOf(number);
            case java.math.BigInteger number -> new BigDecimal(number);
            case Number number when Double.isFinite(number.doubleValue()) -> new BigDecimal(number.toString());
            case null, default -> throw new IllegalArgumentException(field + " is not a number");
        };
    }

    private static List<?> list(Object value, String field) {
        if (value == null) return List.of();
        if (value instanceof List<?> list) return list;
        throw new IllegalArgumentException(field + " is not a list");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value, String field) {
        if (value instanceof Map<?, ?> map) return (Map<String, Object>) map;
        throw new IllegalArgumentException(field + " is not an object");
    }

    private static Map<String, Object> optionalMap(Object value, String field) { return value == null ? null : map(value, field); }
}
