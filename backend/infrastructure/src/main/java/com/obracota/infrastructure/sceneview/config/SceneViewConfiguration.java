package com.obracota.infrastructure.sceneview.config;

import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.sceneview.usecase.SceneViews;
import com.obracota.domain.sceneview.port.SceneViewRepository;
import org.springframework.context.annotation.*;

@Configuration
public class SceneViewConfiguration {
    @Bean SceneViews sceneViews(ProjectVersions versions, SceneViewRepository views) { return new SceneViews(versions,views); }
}
