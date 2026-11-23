package com.obracota.infrastructure.agent.adapters.out.ai;

import com.obracota.domain.agent.port.service.AgentModelPort;
import com.obracota.domain.airun.Consumption;
import java.util.*;
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
    private static final Pattern NOTE = Pattern.compile("(?im)^\\d+\\.\\s*cambiar\\s+(?:el\\s+|la\\s+)?([A-Za-z][A-Za-z0-9_]*)\\s+(?:a|por)\\s+(.+?)\\s*\\[");

    private final List<ScriptedTurn> script;
    private int calls;

    public ScriptedAgentModelAdapter(List<ScriptedTurn> script) { this.script = List.copyOf(script); }

    /** Read the marked piece, set the property of the note, preview and submit: the H4 Playwright case. */
    public static ScriptedAgentModelAdapter defaultScript() {
        return new ScriptedAgentModelAdapter(List.of(
            ScriptedTurn.call("get_element", Map.of("globalId", "{{marked}}")),
            ScriptedTurn.call("draft_set_property", Map.of("globalId", "{{marked}}", "pset", "{{pset}}", "property", "{{property}}",
                "value", "{{value}}", "valueType", "{{valueType}}", "scope", "occurrence")),
            ScriptedTurn.call("preview_change", Map.of()),
            ScriptedTurn.call("submit_change", Map.of("summary", "Propuesta del agente de prueba: {{property}} = {{value}}.")),
            ScriptedTurn.say("Borrador listo para tu revisión (agente de prueba, sin IA).")));
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

    private static Map<String, String> context(List<Message> history) {
        var values = new HashMap<String, String>();
        var first = history.isEmpty() ? "" : history.getFirst().parts().stream().filter(Text.class::isInstance).map(part -> ((Text) part).text())
            .findFirst().orElse("");
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
