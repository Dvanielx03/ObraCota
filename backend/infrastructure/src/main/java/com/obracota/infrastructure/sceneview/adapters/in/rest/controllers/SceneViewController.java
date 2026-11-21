package com.obracota.infrastructure.sceneview.adapters.in.rest.controllers;

import com.obracota.application.sceneview.usecase.SceneViews;
import com.obracota.domain.sceneview.model.SceneView;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/api/projects/{project}/versions/{version}/views") @Transactional(readOnly=true)
public class SceneViewController {
    private final SceneViews views;
    public SceneViewController(SceneViews views) { this.views=views; }
    public record SaveView(String name, List<Double> position, List<Double> target, Double span) {}
    public record RenameView(String name) {}
    @GetMapping
    public List<SceneView> list(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user) {
        return views.list(project,user,version);
    }
    @PostMapping @ResponseStatus(HttpStatus.CREATED) @Transactional
    public SceneView save(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestBody SaveView body) {
        if (body.span() == null) throw new IllegalArgumentException("Vista inválida");
        return views.save(project,user,version,body.name(),body.position(),body.target(),body.span());
    }
    @PutMapping("/{id}") @Transactional
    public SceneView rename(@PathVariable UUID project,@PathVariable UUID version,@PathVariable UUID id,@AuthenticationPrincipal UUID user,
            @RequestBody RenameView body) {
        return views.rename(project,user,version,id,body.name());
    }
    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    public void delete(@PathVariable UUID project,@PathVariable UUID version,@PathVariable UUID id,@AuthenticationPrincipal UUID user) {
        views.delete(project,user,version,id);
    }
}
