package com.obracota.infrastructure.sceneview.adapters.in.rest.controllers;

import com.obracota.application.sceneview.usecase.ProjectCover;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

/** Project card image: the preview of a saved view, or 404 while the project has none. */
@RestController @Transactional(readOnly=true)
public class ProjectCoverController {
    private final ProjectCover covers;
    public ProjectCoverController(ProjectCover covers) { this.covers=covers; }
    @GetMapping("/api/projects/{project}/cover")
    public ResponseEntity<byte[]> cover(@PathVariable UUID project,@AuthenticationPrincipal UUID user) {
        return SceneViewController.image(covers.get(project,user));
    }
}
