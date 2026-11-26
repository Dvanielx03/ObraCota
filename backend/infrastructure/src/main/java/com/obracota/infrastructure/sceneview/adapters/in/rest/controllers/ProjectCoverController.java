package com.obracota.infrastructure.sceneview.adapters.in.rest.controllers;

import com.obracota.application.sceneview.usecase.ProjectCover;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

/**
 * Project card image: the preview of a saved view, or 204 while the owner's project has none (the card keeps its
 * gradient; an expected absence is not an error in the browser console). Anyone else gets 404.
 */
@RestController @Transactional(readOnly=true)
public class ProjectCoverController {
    private final ProjectCover covers;
    public ProjectCoverController(ProjectCover covers) { this.covers=covers; }
    @GetMapping("/api/projects/{project}/cover")
    public ResponseEntity<byte[]> cover(@PathVariable UUID project,@AuthenticationPrincipal UUID user) {
        return covers.find(project,user).map(SceneViewController::image).orElseGet(()->ResponseEntity.noContent().build());
    }
}
