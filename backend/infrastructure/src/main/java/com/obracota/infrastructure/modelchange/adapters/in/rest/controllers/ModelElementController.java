package com.obracota.infrastructure.modelchange.adapters.in.rest.controllers;

import com.obracota.application.modelchange.usecase.ModelReading;
import com.obracota.domain.modelchange.port.ModelEnginePort.ElementQuery;
import com.obracota.domain.security.model.Actor;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

/**
 * Readings of a stored IFC version through the engine (§4.4): its summary, a page of its elements, one element and its
 * differences with another revision of the same file.
 * The answers are the engine's JSON as it sent them; ownership and format are proved by {@link ModelReading}.
 */
@RestController
@RequestMapping("/api/projects/{project}/versions/{version}")
public class ModelElementController {
    private final ModelReading reading;

    public ModelElementController(ModelReading reading) { this.reading = reading; }

    @GetMapping("/summary")
    public Map<String, Object> summary(@PathVariable UUID project, @PathVariable UUID version, Actor actor) {
        return reading.summary(actor, project, version);
    }

    @GetMapping("/elements")
    public Map<String, Object> elements(@PathVariable UUID project, @PathVariable UUID version, Actor actor,
                                        @RequestParam(name = "class", required = false) String ifcClass,
                                        @RequestParam(required = false) String name, @RequestParam(required = false) String storey,
                                        @RequestParam(required = false) String query, @RequestParam(required = false) Integer limit,
                                        @RequestParam(required = false) String cursor) {
        return reading.elements(actor, project, version, new ElementQuery(ifcClass, name, storey, query, limit, cursor));
    }

    /** Differences from the revision {@code base} to this one, by GlobalId (H7 · Comparar entre versiones). */
    @GetMapping("/diff")
    public Map<String, Object> diff(@PathVariable UUID project, @PathVariable UUID version, @RequestParam(required = false) UUID base,
                                    Actor actor) {
        return reading.compare(actor, project, version, base);
    }

    @GetMapping("/elements/{guid}")
    public Map<String, Object> element(@PathVariable UUID project, @PathVariable UUID version, @PathVariable String guid, Actor actor) {
        return reading.element(actor, project, version, guid);
    }
}
