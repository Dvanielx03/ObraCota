package com.obracota.application.sceneview.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.sceneview.model.SceneView;
import com.obracota.domain.sceneview.port.SceneViewRepository;
import java.time.Instant;
import java.util.*;

/** Saved views of a version. Every operation first proves the caller owns the project. */
public record SceneViews(ProjectVersions versions, SceneViewRepository views) {
    public static final int LIMIT=24;
    public List<SceneView> list(UUID project, UUID user, UUID version) {
        versions.get(project,user,version);
        return views.list(version);
    }
    public SceneView save(UUID project, UUID user, UUID version, String name, List<Double> position, List<Double> target, double span) {
        versions.get(project,user,version);
        var view=new SceneView(UUID.randomUUID(),version,name,position,target,span,Instant.now());
        if (views.count(version) >= LIMIT) throw new IllegalArgumentException("Esta versión ya tiene "+LIMIT+" vistas guardadas.");
        views.insert(view);
        return view;
    }
    public SceneView rename(UUID project, UUID user, UUID version, UUID id, String name) {
        versions.get(project,user,version);
        var renamed=views.find(version,id).orElseThrow(NotFoundApplicationException::new).renamed(name);
        views.rename(id,renamed.name());
        return renamed;
    }
    public void delete(UUID project, UUID user, UUID version, UUID id) {
        versions.get(project,user,version);
        views.find(version,id).orElseThrow(NotFoundApplicationException::new);
        views.delete(id);
    }
}
