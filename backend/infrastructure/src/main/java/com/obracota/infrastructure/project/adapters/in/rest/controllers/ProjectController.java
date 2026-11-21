package com.obracota.infrastructure.project.adapters.in.rest.controllers;

import com.obracota.application.project.command.*;
import com.obracota.application.project.dto.ProjectResponse;
import com.obracota.application.project.usecase.*;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.security.model.UserId;
import com.obracota.infrastructure.project.adapters.in.rest.dtos.*;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.util.*;

@RestController @RequestMapping("/api/projects") @Transactional(readOnly=true)
public class ProjectController {
    private final RegisterProjectUseCase register;
    private final GetProjectByIdUseCase get;
    private final ListProjectUseCase list;
    private final UpdateProjectUseCase update;
    private final DeleteProjectUseCase delete;
    private final ArchiveProjectUseCase archive;
    public ProjectController(RegisterProjectUseCase register, GetProjectByIdUseCase get, ListProjectUseCase list,
                             UpdateProjectUseCase update, DeleteProjectUseCase delete, ArchiveProjectUseCase archive) {
        this.register=register; this.get=get; this.list=list; this.update=update; this.delete=delete; this.archive=archive;
    }
    @PostMapping @Transactional
    public ResponseEntity<ProjectResponse> create(@AuthenticationPrincipal UUID user,@Valid @RequestBody CreateProjectRequest request) {
        var result=register.execute(new RegisterProjectCommand(new UserId(user),request.name()));
        return ResponseEntity.created(URI.create("/api/projects/"+result.id())).body(result);
    }
    @GetMapping public List<ProjectResponse> list(@AuthenticationPrincipal UUID user) { return list.execute(new UserId(user)); }
    @GetMapping("/{id}") public ProjectResponse get(@AuthenticationPrincipal UUID user,@PathVariable UUID id) {
        return get.execute(new ProjectId(id),new UserId(user));
    }
    @PutMapping("/{id}") @Transactional public ProjectResponse update(@AuthenticationPrincipal UUID user,@PathVariable UUID id,
            @Valid @RequestBody UpdateProjectRequest request) {
        return update.execute(new UpdateProjectCommand(new ProjectId(id),new UserId(user),request.name()));
    }
    @PutMapping("/{id}/archived") @Transactional public ProjectResponse archive(@AuthenticationPrincipal UUID user,@PathVariable UUID id,
            @Valid @RequestBody ArchiveProjectRequest request) {
        return archive.execute(new ProjectId(id),new UserId(user),request.archived());
    }
    @DeleteMapping("/{id}") @Transactional @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal UUID user,@PathVariable UUID id) { delete.execute(new ProjectId(id),new UserId(user)); }
}
