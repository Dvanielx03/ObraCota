package com.obracota.infrastructure.agent.adapters.out.ai;

import com.obracota.domain.agent.port.service.AgentModelPort;
import com.obracota.domain.airun.Consumption;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@link AgentModelPort} without network or AI (profile {@code agent-fake}, {@code AGENT_PROVIDER=fake}): it answers a
 * scripted sequence of turns, one per model step, so the loop, the catalog, the diary and the interface can be tested
 * for free. It costs nothing and reserves no budget.
 * <p>
 * Argument values may be placeholders, filled from the conversation the run sent:
 * <ul>
 *   <li>{@code {{marked}}}: the first marked GlobalId of the owner's notes;</li>
 *   <li>{@code {{property}}} and {@code {{value}}}: from a note «Cambiar &lt;Propiedad&gt; a &lt;valor&gt;»;</li>
 *   <li>{@code {{pset}}} and {@code {{valueType}}}: the property set that holds that property in the last
 *       {@code get_element} answer, and its IFC type (text, boolean or number). Without it, {@code Pset_<Clase>Common}.</li>
 * </ul>
 * On a DWG drawing (the request declares {@code get_dwg_entity}) the script is the drawing's: read the marked entity,
 * one {@code draft_dwg_change} from the first note, preview and submit. The note is read deterministically
 * ({@link #drawingChange}): «Cambiar texto a …», «Cambiar capa a …», «Cambiar color a rojo», «Mover 500 mm a la derecha»,
 * «Agregar nota: …». Any other note ends the run without a change.
 */
public final class ScriptedAgentModelAdapter implements AgentModelPort {
    /** One step of the script: tool calls (name and arguments), a closing text, or a provider failure. */
    public record ScriptedTurn(List<Map.Entry<String, Map<String, Object>>> calls, String text, String failure) {
        public static ScriptedTurn calls(List<Map.Entry<String, Map<String, Object>>> calls) { return new ScriptedTurn(calls, null, null); }

        public static ScriptedTurn call(String name, Map<String, Object> args) { return calls(List.of(Map.entry(name, args))); }

        public static ScriptedTurn say(String text) { return new ScriptedTurn(List.of(), text, null); }

        public static ScriptedTurn fail(String code) { return new ScriptedTurn(List.of(), null, code); }
    }

    private static final Pattern MARKED = Pattern.compile("pieza ([0-9A-Za-z_$]{22})");
    private static final Pattern MARKED_ENTITY = Pattern.compile("entidad DWG ([0-9A-F]{1,16})");
    private static final Pattern FIRST_NOTE = Pattern.compile("(?m)^1\\.\\s*(.+?)\\s*\\[marca sobre la entidad DWG [0-9A-F]{1,16}\\]$");
    private static final Pattern SET_TEXT = Pattern.compile("(?iu)^(?:cambiar|cambia|poner|pon|reemplazar|reemplaza|sustituir|sustituye)\\s+(?:el\\s+)?(?:texto|r[oó]tulo|cota|valor de la cota)\\s+(?:a|por|con)\\s*:?\\s+(.+)$");
    private static final Pattern SET_LAYER = Pattern.compile("(?iu)^(?:cambiar|cambia|pasar|pasa|mover|mueve)\\s+(?:(?:la\\s+)?capa\\s+(?:a|por)|a\\s+la\\s+capa)\\s*:?\\s+(.+)$");
    private static final Pattern SET_COLOR = Pattern.compile("(?iu)^(?:cambiar|cambia|poner|pon)\\s+(?:el\\s+)?color\\s+(?:a|por|en)\\s*:?\\s+(.+)$");
    private static final Pattern MOVE = Pattern.compile("(?iu)^(?:mover|mueve|desplazar|desplaza)\\s+(\\d+(?:[.,]\\d+)?)\\s*"
        + "(mm|mil[ií]metros?|cm|cent[ií]metros?|m|metros?|in|pulgadas?|ft|pies?)?\\s+(?:a\\s+la\\s+|hacia\\s+(?:la\\s+|el\\s+)?)?"
        + "(derecha|izquierda|arriba|abajo)\\b.*$");
    private static final Pattern ADD_NOTE = Pattern.compile("(?iu)^(?:agregar|agrega|añadir|añade|poner|pon)\\s+(?:una\\s+)?nota\\s*:?\\s*(.+)$");
    private static final Map<String, Integer> COLORS = Map.ofEntries(Map.entry("rojo", 1), Map.entry("roja", 1),
        Map.entry("amarillo", 2), Map.entry("amarilla", 2), Map.entry("verde", 3), Map.entry("cian", 4), Map.entry("azul", 5),
        Map.entry("magenta", 6), Map.entry("blanco", 7), Map.entry("negro", 7), Map.entry("gris", 8), Map.entry("por capa", 256),
        Map.entry("bylayer", 256));
    private static final Pattern NOTE = Pattern.compile("(?im)^\\d+\\.\\s*cambiar\\s+(?:el\\s+|la\\s+)?([A-Za-z][A-Za-z0-9_]*)\\s+(?:a|por)\\s+(.+?)\\s*\\[");
    private static final Pattern SINGLE_PROPERTY_NOTE = Pattern.compile(
        "(?i)\\n1\\.[ \\t]+cambiar[ \\t]+(?:el[ \\t]+|la[ \\t]+)?[A-Za-z][A-Za-z0-9_]*[ \\t]+(?:a|por)[ \\t]+[^\\r\\n]+ \\[marca sobre la pieza [0-9A-Za-z_$]{22}\\]\\n\\nDatos del modelo");

    private final List<ScriptedTurn> script;
    private final boolean singlePropertyOnly;
    private int calls;

    public ScriptedAgentModelAdapter(List<ScriptedTurn> script) { this(script, false); }

    private ScriptedAgentModelAdapter(List<ScriptedTurn> script, boolean singlePropertyOnly) {
        this.script = List.copyOf(script);
        this.singlePropertyOnly = singlePropertyOnly;
    }

    /** Read the marked piece, set the property of the note, preview and submit: the H4 Playwright case. */
    public static ScriptedAgentModelAdapter defaultScript() {
        return new ScriptedAgentModelAdapter(List.of(
            ScriptedTurn.call("get_element", Map.of("globalId", "{{marked}}")),
            ScriptedTurn.call("draft_set_property", Map.of("globalId", "{{marked}}", "pset", "{{pset}}", "property", "{{property}}",
                "value", "{{value}}", "valueType", "{{valueType}}", "scope", "occurrence")),
            ScriptedTurn.call("preview_change", Map.of()),
            ScriptedTurn.call("submit_change", Map.of("summary", "Propuesta del agente de prueba: {{property}} = {{value}}.")),
            ScriptedTurn.say("Fin del guion.")), true);
    }

    /** How many times the model was asked: a test checks that a failure is never repeated. */
    public synchronized int calls() { return calls; }

    @Override public String provider() { return "fake"; }

    @Override public boolean paid() { return false; }

    @Override public boolean configured() { return true; }

    @Override
    public synchronized Turn next(Request request) {
        calls++;
        int index = (int) request.history().stream().filter(message -> message.role() == Role.MODEL).count();
        var none = new Consumption(0, 0, 0);
        if (request.tools().stream().anyMatch(tool -> "get_dwg_entity".equals(tool.name()))) return drawingTurn(request, index, none);
        if (singlePropertyOnly && index == 0 && !SINGLE_PROPERTY_NOTE.matcher(firstText(request.history())).find())
            return new Turn(new Message(Role.MODEL, List.of(), null), none);
        if (index >= script.size()) return new Turn(new Message(Role.MODEL, List.of(new Text("Fin del guion.")), null), none);
        var turn = script.get(index);
        if (turn.failure() != null) throw new Failure(turn.failure(), none);
        var context = context(request.history());
        var parts = new ArrayList<Part>();
        int n = 0;
        for (var call : turn.calls()) parts.add(new Call("call-" + index + "-" + (++n), call.getKey(), resolve(call.getValue(), context)));
        if (turn.text() != null) parts.add(new Text(turn.text()));
        return new Turn(new Message(Role.MODEL, parts, null), none);
    }

    /** The drawing's script: read, draft the note's change, preview, submit. */
    private static Turn drawingTurn(Request request, int index, Consumption none) {
        var first = firstText(request.history());
        var marked = MARKED_ENTITY.matcher(first);
        var change = drawingChange(first);
        if (!marked.find() || change == null) return new Turn(new Message(Role.MODEL, List.of(), null), none);
        var handle = marked.group(1);
        Part part = switch (index) {
            case 0 -> new Call("call-0-1", "get_dwg_entity", Map.of("handle", handle));
            case 1 -> {
                var args = new LinkedHashMap<String, Object>(change);
                args.put("handle", handle);
                yield new Call("call-1-1", "draft_dwg_change", args);
            }
            case 2 -> new Call("call-2-1", "preview_change", Map.of());
            case 3 -> new Call("call-3-1", "submit_change", Map.of("summary", "Propuesta del agente de prueba: " + summary(change) + "."));
            default -> new Text("Fin del guion.");
        };
        return new Turn(new Message(Role.MODEL, List.of(part), null), none);
    }

    /**
     * The {@code draft_dwg_change} arguments of the first note on an entity, or null when the note is not one of the
     * changes the test agent understands.
     */
    public static Map<String, Object> drawingChange(String prompt) {
        var note = FIRST_NOTE.matcher(prompt);
        if (!note.find()) return null;
        var text = note.group(1).strip();
        Matcher found;
        if ((found = SET_TEXT.matcher(text)).matches()) return Map.of("action", "set_text", "text", clean(found.group(1)));
        if ((found = SET_LAYER.matcher(text)).matches()) return Map.of("action", "set_layer", "layer", clean(found.group(1)));
        if ((found = ADD_NOTE.matcher(text)).matches()) return Map.of("action", "add_note", "text", clean(found.group(1)));
        if ((found = SET_COLOR.matcher(text)).matches()) {
            var value = clean(found.group(1)).toLowerCase(Locale.ROOT);
            var color = COLORS.get(value);
            if (color == null && value.matches("\\d{1,3}")) color = Integer.parseInt(value);
            return color == null || color > 256 ? null : Map.of("action", "set_color", "color", color);
        }
        if ((found = MOVE.matcher(text)).matches()) {
            var amount = new BigDecimal(found.group(1).replace(',', '.'));
            var unit = unit(found.group(2));
            var direction = found.group(3).toLowerCase(Locale.ROOT);
            var negative = direction.equals("izquierda") || direction.equals("abajo");
            var value = negative ? amount.negate() : amount;
            var horizontal = direction.equals("derecha") || direction.equals("izquierda");
            return Map.of("action", "move", "dx", horizontal ? value : BigDecimal.ZERO, "dy", horizontal ? BigDecimal.ZERO : value, "unit", unit);
        }
        return null;
    }

    private static String unit(String word) {
        if (word == null) return "mm";
        var value = word.toLowerCase(Locale.ROOT);
        if (value.startsWith("mm") || value.startsWith("mil")) return "mm";
        if (value.startsWith("c")) return "cm";
        if (value.equals("m") || value.startsWith("metro")) return "m";
        if (value.equals("in") || value.startsWith("pulgada")) return "in";
        return "ft";
    }

    /** The value of a note without its closing period or quotes. */
    private static String clean(String value) {
        var out = value.strip().replaceAll("[.\\s]+$", "");
        if (out.length() >= 2 && "«\"'“".indexOf(out.charAt(0)) >= 0 && "»\"'”".indexOf(out.charAt(out.length() - 1)) >= 0)
            out = out.substring(1, out.length() - 1).strip();
        return out;
    }

    private static String summary(Map<String, Object> change) {
        return switch (String.valueOf(change.get("action"))) {
            case "set_text" -> "texto = " + change.get("text");
            case "set_layer" -> "capa = " + change.get("layer");
            case "set_color" -> "color = " + change.get("color");
            case "move" -> "mover " + change.get("dx") + ", " + change.get("dy") + " " + change.get("unit");
            default -> "nota «" + change.get("text") + "»";
        };
    }

    private static Map<String, String> context(List<Message> history) {
        var values = new HashMap<String, String>();
        var first = firstText(history);
        var marked = MARKED.matcher(first);
        if (marked.find()) values.put("marked", marked.group(1));
        var note = NOTE.matcher(first);
        if (note.find()) {
            values.put("property", note.group(1));
            values.put("value", note.group(2).replaceAll("[.\\s]+$", ""));
        }
        values.put("valueType", "text");
        String ifcClass = null;
        for (var message : history) for (var part : message.parts()) {
            if (!(part instanceof Response response) || !"get_element".equals(response.name())) continue;
            if (!(response.result().get("data") instanceof Map<?, ?> data)) continue;
            if (data.get("class") instanceof String name) ifcClass = name;
            if (!(data.get("psets") instanceof List<?> psets)) continue;
            for (var pset : psets) {
                if (!(pset instanceof Map<?, ?> set) || !(set.get("properties") instanceof List<?> properties)) continue;
                for (var property : properties) {
                    if (property instanceof Map<?, ?> prop && Objects.equals(prop.get("name"), values.get("property"))) {
                        values.putIfAbsent("pset", String.valueOf(set.get("name")));
                        values.put("valueType", kind(prop.get("ifc_type")));
                    }
                }
            }
        }
        if (!values.containsKey("pset") && ifcClass != null && ifcClass.startsWith("Ifc"))
            values.put("pset", "Pset_" + ifcClass.substring(3) + "Common");
        values.putIfAbsent("pset", "Pset_DoorCommon");
        return values;
    }

    private static String firstText(List<Message> history) {
        return history.isEmpty() ? "" : history.getFirst().parts().stream().filter(Text.class::isInstance)
            .map(part -> ((Text) part).text()).findFirst().orElse("");
    }

    private static String kind(Object ifcType) {
        if (!(ifcType instanceof String type)) return "text";
        if (type.equals("IfcBoolean") || type.equals("IfcLogical")) return "boolean";
        if (type.contains("Measure") || type.equals("IfcReal") || type.equals("IfcInteger") || type.equals("IfcCountMeasure")) return "number";
        return "text";
    }

    private static Map<String, Object> resolve(Map<String, Object> args, Map<String, String> context) {
        var out = new LinkedHashMap<String, Object>();
        args.forEach((key, value) -> out.put(key, value instanceof String text ? fill(text, context) : value));
        return out;
    }

    private static String fill(String text, Map<String, String> context) {
        var out = text;
        for (var entry : context.entrySet()) out = out.replace("{{" + entry.getKey() + "}}", entry.getValue());
        return out;
    }
}
