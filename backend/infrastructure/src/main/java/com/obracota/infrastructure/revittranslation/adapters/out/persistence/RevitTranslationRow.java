package com.obracota.infrastructure.revittranslation.adapters.out.persistence;

import com.obracota.domain.revittranslation.model.RevitTranslation;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="revit_translation")
public class RevitTranslationRow {
    @Id private UUID id;
    private UUID projectId, versionId, resultVersionId;
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
