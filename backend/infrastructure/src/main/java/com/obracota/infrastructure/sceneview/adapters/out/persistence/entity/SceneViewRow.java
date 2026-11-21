package com.obracota.infrastructure.sceneview.adapters.out.persistence.entity;

import com.obracota.domain.sceneview.model.SceneView;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Entity @Table(name="scene_view")
public class SceneViewRow {
    @Id private UUID id;
    private UUID versionId;
    private String name;
    private double px, py, pz, tx, ty, tz, span;
    private Instant createdAt;
    protected SceneViewRow() {}
    public SceneViewRow(SceneView v) {
        id=v.id(); versionId=v.versionId(); name=v.name(); span=v.span(); createdAt=v.createdAt();
        px=v.position().get(0); py=v.position().get(1); pz=v.position().get(2);
        tx=v.target().get(0); ty=v.target().get(1); tz=v.target().get(2);
    }
    public void rename(String value) { name=value; }
    public SceneView toDomain() { return new SceneView(id,versionId,name,List.of(px,py,pz),List.of(tx,ty,tz),span,createdAt); }
}
