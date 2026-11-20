package com.obracota.application.modelfile.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.domain.modelfile.port.repository.ModelFileRepository;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.project.port.repository.ProjectRepository;
import com.obracota.domain.security.model.UserId;
import java.util.*;

public record ProjectFileCatalog(ProjectRepository projects, ModelFileRepository files) {
    public void requireOwner(UUID project, UUID user) {
        projects.findById(new ProjectId(project), new UserId(user)).orElseThrow(NotFoundApplicationException::new);
    }
    public List<ModelFile> list(UUID project, UUID user) {
        requireOwner(project,user);
        return files.list(project);
    }
    public ModelFile resolveUpload(UUID project, UUID user, UUID fileId, String name) {
        projects.findForUpdate(new ProjectId(project),new UserId(user)).orElseThrow(NotFoundApplicationException::new);
        String format = ModelFile.formatOf(name);
        Optional<ModelFile> existing = fileId == null ? files.named(project,name) : Optional.of(
            files.find(project,fileId).orElseThrow(NotFoundApplicationException::new));
        if (existing.isPresent()) {
            if (!existing.get().format().equals(format)) throw new IllegalArgumentException("Formato distinto al del archivo");
            return existing.get();
        }
        ModelFile file = ModelFile.register(project,name);
        files.add(file);
        return file;
    }
}
