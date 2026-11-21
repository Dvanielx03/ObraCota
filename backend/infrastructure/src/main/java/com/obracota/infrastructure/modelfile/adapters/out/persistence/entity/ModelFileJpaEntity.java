package com.obracota.infrastructure.modelfile.adapters.out.persistence.entity;

import com.obracota.domain.modelfile.model.ModelFile;
import jakarta.persistence.*;
import java.util.UUID;

@Entity @Table(name="model_file")
public class ModelFileJpaEntity {
    @Id private UUID id;
    private UUID projectId;
    private String name;
    private String format;
    protected ModelFileJpaEntity() {}
    public ModelFileJpaEntity(ModelFile file) {
        id=file.id(); projectId=file.projectId(); name=file.name(); format=file.format();
    }
    public ModelFile toDomain() { return new ModelFile(id,projectId,name,format); }
}
