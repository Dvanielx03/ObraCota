package com.obracota.domain.modelfile.port.repository;

import com.obracota.domain.modelfile.model.ModelFile;
import java.util.*;

public interface ModelFileRepository {
    void add(ModelFile file);
    Optional<ModelFile> find(UUID project, UUID file);
    Optional<ModelFile> named(UUID project, String name);
    List<ModelFile> list(UUID project);
}
