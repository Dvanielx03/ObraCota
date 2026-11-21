package com.obracota.infrastructure.modelfile.adapters.in.rest.controllers;

import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.domain.modelfile.model.ModelFile;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/api/projects/{project}/files")
public record ModelFileController(ProjectFileCatalog catalog) {
    @GetMapping public List<ModelFile> list(@PathVariable UUID project,@AuthenticationPrincipal UUID user) {
        return catalog.list(project,user);
    }
}
