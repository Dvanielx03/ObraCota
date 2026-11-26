package com.obracota.infrastructure.revittranslation.adapters.out.persistence;

import com.obracota.domain.revittranslation.model.RevitTranslation;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="revit_translation")
public class RevitTranslationRow {
    @Id private UUID id;
    private UUID versionId, resultVersionId;
    /** The project is the one of the RVT version (V24): read through {@code version_id}, never written here. */
    @org.hibernate.annotations.Formula("(select f.project_id from model_version v join model_file f on f.id = v.file_id where v.id = version_id)")
    private UUID projectId;
    @Enumerated(EnumType.STRING) private RevitTranslation.Status status;
    private String message;
    private Instant createdAt, updatedAt;
    protected RevitTranslationRow() {}
    public RevitTranslationRow(RevitTranslation t) {
        id=t.id(); projectId=t.projectId(); versionId=t.versionId(); status=t.status(); message=t.message();
        resultVersionId=t.resultVersionId(); createdAt=t.createdAt(); updatedAt=t.updatedAt();
    }
    public RevitTranslation toDomain() {
        return new RevitTranslation(id,projectId,versionId,status,message,resultVersionId,createdAt,updatedAt);
    }
}
