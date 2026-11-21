package com.obracota.infrastructure.modelfile.config;

import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.domain.modelfile.port.repository.ModelFileRepository;
import com.obracota.domain.project.port.repository.ProjectRepository;
import org.springframework.context.annotation.*;

@Configuration
public class ModelFileConfiguration {
    @Bean ProjectFileCatalog fileCatalog(ProjectRepository projects, ModelFileRepository files) {
        return new ProjectFileCatalog(projects,files);
    }
}
