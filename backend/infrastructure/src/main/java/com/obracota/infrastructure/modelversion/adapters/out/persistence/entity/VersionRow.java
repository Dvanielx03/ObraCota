package com.obracota.infrastructure.modelversion.adapters.out.persistence.entity;

import com.obracota.domain.modelversion.model.ModelVersion;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="model_version")
public class VersionRow {
    @Id private UUID id;
    private UUID fileId, uploadedBy;
    private int revision;
    private String name, format, sha256, uploaderEmail;
    private long byteSize;
    private Instant uploadedAt;
    protected VersionRow() {}
    public VersionRow(ModelVersion v) {
        id=v.id(); fileId=v.fileId(); revision=v.revision(); name=v.name(); format=v.format();
        byteSize=v.byteSize(); sha256=v.sha256(); uploadedAt=v.uploadedAt(); uploadedBy=v.uploadedBy(); uploaderEmail=v.uploaderEmail();
    }
    public ModelVersion toDomain() { return new ModelVersion(id,fileId,revision,name,format,byteSize,sha256,uploadedAt,uploadedBy,uploaderEmail); }
}
