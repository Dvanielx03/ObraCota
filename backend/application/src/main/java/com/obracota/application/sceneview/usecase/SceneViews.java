package com.obracota.application.sceneview.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.sceneview.model.SceneView;
import com.obracota.domain.sceneview.model.ViewThumbnail;
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
        return save(project,user,version,name,position,target,span,null);
    }
    /** {@code thumbnail} is an optional {@code data:image/jpeg;base64,…} URL of at most {@link ViewThumbnail#LIMIT} bytes. */
    public SceneView save(UUID project, UUID user, UUID version, String name, List<Double> position, List<Double> target, double span,
                          String thumbnail) {
        versions.get(project,user,version);
        var image=Optional.ofNullable(thumbnail).map(ViewThumbnail::fromDataUrl);
        var view=new SceneView(UUID.randomUUID(),version,name,position,target,span,Instant.now(),image.isPresent());
        if (views.count(version) >= LIMIT) throw new IllegalArgumentException("Esta versión ya tiene "+LIMIT+" vistas guardadas.");
        views.insert(view,image);
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
    /** Preview of one view; missing when the view does not exist, has no preview or belongs to someone else. */
    public ViewThumbnail thumbnail(UUID project, UUID user, UUID version, UUID id) {
        versions.get(project,user,version);
        return views.thumbnail(version,id).orElseThrow(NotFoundApplicationException::new);
    }
}
