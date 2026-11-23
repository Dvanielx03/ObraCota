package com.obracota.domain.agent.port.service;

import com.obracota.domain.airun.Consumption;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * The model that drives the design agent (PROPUESTA §3.1, H4): it receives the conversation so far and the declarations
 * of the catalog, and answers with text and calls to declared tools. It never runs a tool itself; the loop in
 * {@code RunDesignAgent} validates every call before executing it.
 * <p>
 * {@link Message#raw()} keeps the provider's own content of a model turn (for Gemini, the {@code content} object with
 * its thought signatures), so the adapter can send it back unchanged on the next step.
 */
public interface AgentModelPort {
    /** Name written in the run: {@code gemini}, {@code fake}. */
    String provider();

    /** Whether a step costs money; only then does the run reserve budget and write {@code ai_run}. */
    boolean paid();

    /** Whether the provider can be called at all (for Gemini, the server has its key). */
    boolean configured();

    /** One step of the model. */
    Turn next(Request request);

    /** A function the model may call, with its JSON schema (OpenAPI subset). */
    record Tool(String name, String description, Map<String, Object> parameters) {
        public Tool {
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(description, "description");
            parameters = parameters == null ? Map.of("type", "object", "properties", Map.of()) : parameters;
        }
    }

    record Request(String model, String system, List<Message> history, List<Tool> tools) {
        public Request {
            history = List.copyOf(history);
            tools = List.copyOf(tools);
        }
    }

    enum Role { USER, MODEL }

    /** A turn of the conversation. {@code raw} is only set on model turns, by the adapter that produced them. */
    record Message(Role role, List<Part> parts, String raw) {
        public Message { parts = List.copyOf(parts); }

        public static Message user(List<Part> parts) { return new Message(Role.USER, parts, null); }
    }

    sealed interface Part permits Text, Call, Response {}

    record Text(String text) implements Part {}

    /** A call the model asked for. {@code id} is the provider's id when it gives one, echoed in the {@link Response}. */
    record Call(String id, String name, Map<String, Object> args) implements Part {
        public Call { args = args == null ? Map.of() : args; }
    }

    /** What a tool answered, sent back to the model as data. */
    record Response(String id, String name, Map<String, Object> result) implements Part {}

    /** The model's answer: its message (with {@code raw}) and what it consumed. */
    record Turn(Message message, Consumption usage) {
        public List<Call> calls() {
            return message.parts().stream().filter(Call.class::isInstance).map(Call.class::cast).toList();
        }

        public String text() {
            var out = new StringBuilder();
            message.parts().stream().filter(Text.class::isInstance).map(Text.class::cast).forEach(part -> out.append(part.text()));
            return out.toString();
        }
    }

    /** The provider failed ({@code HTTP_429}, {@code NETWORK_ERROR}…). The loop never repeats the paid call. */
    final class Failure extends RuntimeException {
        private final Consumption usage;

        public Failure(String code) { this(code, new Consumption(null, null, null)); }

        public Failure(String code, Consumption usage) {
            super(code);
            this.usage = usage;
        }

        public String code() { return getMessage(); }

        public Consumption usage() { return usage; }
    }
}
