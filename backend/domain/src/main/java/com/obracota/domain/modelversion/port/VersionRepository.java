package com.obracota.domain.modelversion.port;

import com.obracota.domain.modelversion.model.ModelVersion;
import java.util.*;

public interface VersionRepository {
    List<ModelVersion> history(UUID file);
    int nextRevision(UUID file);
    void insert(ModelVersion version);
    Optional<ModelVersion> find(UUID project, UUID version);
    Map<String,String> notes(UUID version);
    void writeNote(UUID version,String key,String text,boolean onlyIfAbsent);
}
