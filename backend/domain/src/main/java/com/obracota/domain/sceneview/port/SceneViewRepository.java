package com.obracota.domain.sceneview.port;

import com.obracota.domain.sceneview.model.SceneView;
import com.obracota.domain.sceneview.model.ViewThumbnail;
import java.util.*;

public interface SceneViewRepository {
    List<SceneView> list(UUID version);
    long count(UUID version);
    Optional<SceneView> find(UUID version, UUID id);
    /** Stores the view and, when present, its preview. */
    void insert(SceneView view, Optional<ViewThumbnail> thumbnail);
    void rename(UUID id, String name);
    void delete(UUID id);
    Optional<ViewThumbnail> thumbnail(UUID version, UUID id);
    /**
     * Preview of the first saved view (by date) of the project's most recent version
     * that has at least one view with a preview.
     */
    Optional<ViewThumbnail> cover(UUID project);
}
