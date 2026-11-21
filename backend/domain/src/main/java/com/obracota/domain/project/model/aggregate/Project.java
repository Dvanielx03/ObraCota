package com.obracota.domain.project.model.aggregate;

import com.obracota.domain.common.model.AggregateRoot;
import com.obracota.domain.project.event.*;
import com.obracota.domain.project.model.valueobject.ProjectId;
import com.obracota.domain.security.model.UserId;
import java.time.Instant;
import java.util.Objects;

public final class Project extends AggregateRoot {
    private final ProjectId id;
    private final UserId owner;
    private String name;
    private boolean archived;
    private final Instant updatedAt;
    private Project(ProjectId id, UserId owner, String name, boolean archived, Instant updatedAt) {
        this.id=Objects.requireNonNull(id); this.owner=Objects.requireNonNull(owner);
        this.name=validate(name); this.archived=archived; this.updatedAt=updatedAt;
    }
    private static String validate(String name) {
        if (name == null || name.isBlank() || name.strip().length() > 120)
            throw new IllegalArgumentException("Nombre de proyecto inválido");
        return name.strip();
    }
    public static Project register(UserId owner, String name) {
        var project=new Project(ProjectId.generate(),owner,name,false,Instant.now());
        project.record(new ProjectRegisteredEvent(project.id,Instant.now()));
        return project;
    }
    public static Project restore(ProjectId id, UserId owner, String name, boolean archived, Instant updatedAt) {
        return new Project(id,owner,name,archived,updatedAt);
    }
    public void rename(String value) {
        name=validate(value);
        record(new ProjectUpdatedEvent(id,Instant.now()));
    }
    public void archive(boolean value) {
        if (archived == value) return;
        archived=value;
        record(new ProjectUpdatedEvent(id,Instant.now()));
    }
    public void delete() { record(new ProjectDeletedEvent(id,Instant.now())); }
    public ProjectId id() { return id; }
    public UserId owner() { return owner; }
    public String name() { return name; }
    public boolean archived() { return archived; }
    public Instant updatedAt() { return updatedAt; }
}
