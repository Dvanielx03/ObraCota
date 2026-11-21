package com.obracota.domain.sceneview.port;

import com.obracota.domain.sceneview.model.SceneView;
import java.util.*;

public interface SceneViewRepository {
    List<SceneView> list(UUID version);
    long count(UUID version);
    Optional<SceneView> find(UUID version, UUID id);
    void insert(SceneView view);
    void rename(UUID id, String name);
    void delete(UUID id);
}
