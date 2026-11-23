package com.obracota.infrastructure.agent.adapters.in.rest;

import com.obracota.application.agent.RunDesignAgent;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.domain.security.model.Actor;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
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
    private final AiBudget budget;

    public AgentRunController(RunDesignAgent agent, AiBudget budget) {
        this.agent = agent;
        this.budget = budget;
    }

    public record NoteBody(String globalId, String name, String text) {}
    public record RunBody(UUID version, List<NoteBody> notes) {}
    public record StepView(int step, int seq, String tool, String status, String errorCode, String detail) {}
    public record RunView(UUID id, String status, String provider, String model, UUID change, String message, List<StepView> steps) {}
    public record Availability(boolean available, String provider, int reserveCents, int remainingCents, int maxSteps) {}

    @ModelAttribute
    void noStore(HttpServletResponse response) { response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue()); }

    /** Whether the agent can run and what one run reserves (0 with the test agent, which costs nothing). */
    @GetMapping
    public Availability availability(@PathVariable UUID project, Actor actor) {
        if (!actor.person()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        boolean paid = !"fake".equals(agent.provider());
        return new Availability(agent.available(), agent.provider(), paid ? RunDesignAgent.RESERVE_CENTS : 0, budget.remaining(),
            RunDesignAgent.MAX_STEPS);
    }

    @PostMapping
    public RunView run(@PathVariable UUID project, Actor actor, @RequestBody RunBody body) {
        if (body == null) throw new IllegalArgumentException("Falta el cuerpo");
        var notes = body.notes() == null ? List.<RunDesignAgent.Note>of()
            : body.notes().stream().map(note -> note == null ? null : new RunDesignAgent.Note(note.globalId(), note.name(), note.text())).toList();
        try {
            var result = agent.run(actor, project, body.version(), notes);
            return new RunView(result.run(), result.status().name(), result.provider(), result.model(), result.change(), result.message(),
                result.steps().stream().map(step -> new StepView(step.step(), step.seq(), step.tool(), step.status().name(), step.errorCode(),
                    step.detail())).toList());
        } catch (AiBudget.Exhausted e) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Se agotó el presupuesto mensual de IA.");
        }
    }

    @GetMapping("/{run}")
    public List<StepView> steps(@PathVariable UUID project, @PathVariable UUID run, Actor actor) {
        return agent.steps(actor, project, run).stream()
            .map(step -> new StepView(step.step(), step.seq(), step.tool(), step.status().name(), step.errorCode(), step.detail())).toList();
    }
}
