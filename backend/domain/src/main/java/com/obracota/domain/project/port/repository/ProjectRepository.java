package com.obracota.domain.project.port.repository;

import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.security.model.UserId;
import java.util.*;

public interface ProjectRepository {
    void save(Project project);
    Optional<Project> findById(ProjectId id, UserId owner);
    Optional<Project> findForUpdate(ProjectId id, UserId owner);
    List<Project> findAll(UserId owner);
    void delete(Project project);
}
