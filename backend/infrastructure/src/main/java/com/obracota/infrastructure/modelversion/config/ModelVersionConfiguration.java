package com.obracota.infrastructure.modelversion.config;

import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.modelversion.usecase.VersionSolids;
import com.obracota.domain.modelversion.port.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.infrastructure.modelversion.adapters.out.storage.VolumeStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import java.nio.file.Path;

@Configuration
public class ModelVersionConfiguration {
    @Bean VolumeStorage originals(@Value("${models.directory:/srv/originals}") Path directory) { return new VolumeStorage(directory); }
    @Bean ProjectVersions versions(ProjectFileCatalog catalog,VersionRepository versions,OriginalStorage storage,SecurityRepository users) {
        return new ProjectVersions(catalog,versions,storage,users);
    }
    @Bean VersionSolids versionSolids(ProjectVersions versions,SolidMeshPort engine) { return new VersionSolids(versions,engine); }
}
