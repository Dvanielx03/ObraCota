package com.obracota.application.sceneview.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.domain.sceneview.model.ViewThumbnail;
import com.obracota.domain.sceneview.port.SceneViewRepository;
import java.util.Optional;
import java.util.UUID;

/**
 * Cover image of a project: the preview of the first saved view of its most recent version
 * that has any view with a preview. Only the owner can read it; anyone else gets "not found".
 */
public record ProjectCover(ProjectFileCatalog catalog, SceneViewRepository views) {
    public ViewThumbnail get(UUID project, UUID user) {
        return find(project,user).orElseThrow(NotFoundApplicationException::new);
    }
    /** The cover, or empty while the owner's project has no view with a preview (anyone else: not found). */
    public Optional<ViewThumbnail> find(UUID project, UUID user) {
        catalog.requireOwner(project,user);
        return views.cover(project);
    }
}
