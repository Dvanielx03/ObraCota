package com.obracota.infrastructure.project.adapters.out.persistence.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="project")
public class ProjectJpaEntity {
    @Id public UUID id;
    @Column(nullable=false,updatable=false) public UUID ownerId;
    @Column(nullable=false,length=120) public String name;
    private Instant createdAt;
    private Instant updatedAt;
    protected ProjectJpaEntity() {}
    public ProjectJpaEntity(UUID id, UUID ownerId, String name) {
        this.id=id; this.ownerId=ownerId; this.name=name;
    }
    @PrePersist void created() { createdAt=updatedAt=Instant.now(); }
    @PreUpdate void updated() { updatedAt=Instant.now(); }
}
