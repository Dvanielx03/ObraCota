package com.obracota.infrastructure.agent.adapters.in.rest;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.agent.RunDesignAgent;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.common.exception.ForbiddenApplicationException;
import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.domain.security.model.Actor;
import com.obracota.infrastructure.common.exception.ErrorResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * «Proponer cambio al modelo» (H4): {@code POST /api/projects/{project}/agent-runs} runs the design agent over the notes
 * of Editar and answers when it ends, with its steps and, at best, the draft it left in {@code READY}. Only the owner's
 * browser session reaches it ({@code SecurityConfig}: everything under {@code /api/projects/**} that is not listed for
 * an agent credential needs {@code SESSION_PERSON}); the use case checks it again.
 */
@RestController
@RequestMapping("/api/projects/{project}/agent-runs")
public class AgentRunController {
    private final RunDesignAgent agent;
    private final ObjectMapper json;

    public AgentRunController(RunDesignAgent agent, ObjectMapper json) {
        this.agent = agent;
        this.json = json;
    }

    public record NoteBody(String globalId, String name, String text) {}
    public record RunBody(UUID version, List<NoteBody> notes) {}
    public record StepView(int step, int seq, String tool, String status, String errorCode, String detail) {}
    public record RunView(UUID id, String status, String provider, String model, UUID change, String message, List<StepView> steps) {}

    @ModelAttribute
    void noStore(HttpServletResponse response) { response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue()); }

    /** Whether the agent can run and what one run reserves (0 with the test agent, which costs nothing). */
    @GetMapping
    public RunDesignAgent.Availability availability(@PathVariable UUID project, Actor actor) {
        return agent.availability(actor, project);
    }

    @PostMapping
    public RunView run(@PathVariable UUID project, Actor actor, @RequestBody RunBody body) {
        try {
            return view(agent.run(actor, project, body.version(), notes(body)));
        } catch (AiBudget.Exhausted e) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Se agotó el presupuesto mensual de IA.");
        }
    }

    @PostMapping(value="/stream", produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    public void stream(@PathVariable UUID project, Actor actor, @RequestBody RunBody body, HttpServletResponse response) throws IOException {
        response.setContentType(MediaType.TEXT_EVENT_STREAM_VALUE + ";charset=UTF-8");
        response.setHeader("X-Accel-Buffering", "no");
        try {
            var result = agent.run(actor, project, body.version(), notes(body), step -> event(response, "step", view(step)));
            event(response, "result", view(result));
        } catch (UncheckedIOException disconnected) {
            // The response stopped accepting bytes. End this execution without another provider call.
        } catch (AiBudget.Exhausted error) {
            event(response, "failure", new ErrorResponse("Se agotó el presupuesto mensual de IA."));
        } catch (InvalidRequestApplicationException | UnprocessableApplicationException error) {
            event(response, "failure", new ErrorResponse(error.getMessage()));
        } catch (ForbiddenApplicationException | NotFoundApplicationException error) {
            response.setStatus(error instanceof ForbiddenApplicationException ? 403 : 404);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            json.writeValue(response.getOutputStream(), new ErrorResponse(error.getMessage()));
        }
    }

    private void event(HttpServletResponse response, String kind, Object payload) {
        try {
            var data = "event: " + kind + "\ndata: " + json.writeValueAsString(payload) + "\n\n";
            response.getOutputStream().write(data.getBytes(StandardCharsets.UTF_8));
            response.flushBuffer();
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    private static List<RunDesignAgent.Note> notes(RunBody body) {
        return body.notes() == null ? List.of() : body.notes().stream()
            .map(note -> note == null ? null : new RunDesignAgent.Note(note.globalId(), note.name(), note.text())).toList();
    }

    private static RunView view(RunDesignAgent.Result result) {
        return new RunView(result.run(), result.status().name(), result.provider(), result.model(), result.change(), result.message(),
            result.steps().stream().map(AgentRunController::view).toList());
    }

    private static StepView view(RunDesignAgent.Step step) {
        return new StepView(step.step(), step.seq(), step.tool(), step.status().name(), step.errorCode(), step.detail());
    }

    @GetMapping("/{run}")
    public List<StepView> steps(@PathVariable UUID project, @PathVariable UUID run, Actor actor) {
        return agent.steps(actor, project, run).stream().map(AgentRunController::view).toList();
    }
}
