package com.obracota.infrastructure.modelversion.adapters.in.rest.controllers;

import com.obracota.application.modelversion.usecase.SampleScopes;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * {@code POST /api/projects/sample/restage}: the signed-in person's project and version for the ReStage sample, so the
 * sample viewer uses Renderizar and the 360 panorama through the usual options routes. Idempotent per person.
 */
@RestController @RequestMapping("/api/projects/sample")
public class SampleScopeController {
    private final SampleScopes samples;

    public SampleScopeController(SampleScopes samples) { this.samples = samples; }

    @PostMapping("/{sample}")
    public Map<String, UUID> ensure(@AuthenticationPrincipal UUID user, @PathVariable String sample) {
        var scope = samples.ensure(user, sample);
        return Map.of("project", scope.project(), "version", scope.version());
    }
}
