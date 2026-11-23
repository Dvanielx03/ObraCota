package com.obracota.infrastructure.revittranslation.adapters.in.rest;

import com.obracota.application.revittranslation.usecase.RevitTranslations;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** RVT to IFC with Autodesk Model Derivative (layer 2 of RVT support). The person's session only. */
@RestController @RequestMapping("/api/projects/{project}")
public class RevitTranslationController {
    private final RevitTranslations translations;
    public RevitTranslationController(RevitTranslations translations) { this.translations = translations; }

    @GetMapping("/revit-translation/availability")
    public Map<String, Boolean> availability(@PathVariable UUID project, @AuthenticationPrincipal UUID user) {
        return Map.of("available", translations.available(project, user));
    }

    @PostMapping("/versions/{version}/revit-translation") @ResponseStatus(HttpStatus.ACCEPTED)
    public RevitTranslations.View start(@PathVariable UUID project, @PathVariable UUID version, @AuthenticationPrincipal UUID user) {
        return translations.start(project, user, version);
    }

    /** The latest conversion of the version, or 204 when it never had one. */
    @GetMapping("/versions/{version}/revit-translation")
    public ResponseEntity<RevitTranslations.View> latest(@PathVariable UUID project, @PathVariable UUID version, @AuthenticationPrincipal UUID user) {
        return translations.latest(project, user, version).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }
}
