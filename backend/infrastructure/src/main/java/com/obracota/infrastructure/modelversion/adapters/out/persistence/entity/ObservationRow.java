package com.obracota.infrastructure.modelversion.adapters.out.persistence.entity;

import jakarta.persistence.*;
import java.util.UUID;

@Entity @Table(name="version_observation")
public class ObservationRow {
    @Id private UUID id;
    private UUID versionId;
    private String elementKey, note;
    protected ObservationRow() {}
    public ObservationRow(UUID version,String key,String text) {
        id=UUID.randomUUID(); versionId=version; elementKey=key; note=text;
    }
    public String key() { return elementKey; }
    public String text() { return note; }
    public void replace(String value) { note=value; }
}
