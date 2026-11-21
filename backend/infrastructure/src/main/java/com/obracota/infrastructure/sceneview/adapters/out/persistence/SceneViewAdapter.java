package com.obracota.infrastructure.sceneview.adapters.out.persistence;

import com.obracota.domain.sceneview.model.SceneView;
import com.obracota.domain.sceneview.port.SceneViewRepository;
import com.obracota.infrastructure.sceneview.adapters.out.persistence.entity.SceneViewRow;
import jakarta.persistence.*;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class SceneViewAdapter implements SceneViewRepository {
    @PersistenceContext private EntityManager db;
    public List<SceneView> list(UUID version) {
        return db.createQuery("from SceneViewRow where versionId=:version order by createdAt, id",SceneViewRow.class)
            .setParameter("version",version).getResultList().stream().map(SceneViewRow::toDomain).toList();
    }
    public long count(UUID version) {
        return db.createQuery("select count(v) from SceneViewRow v where v.versionId=:version",Long.class)
            .setParameter("version",version).getSingleResult();
    }
    private Optional<SceneViewRow> row(UUID version, UUID id) {
        return db.createQuery("from SceneViewRow where versionId=:version and id=:id",SceneViewRow.class)
            .setParameter("version",version).setParameter("id",id).getResultList().stream().findFirst();
    }
    public Optional<SceneView> find(UUID version, UUID id) { return row(version,id).map(SceneViewRow::toDomain); }
    public void insert(SceneView view) { db.persist(new SceneViewRow(view)); }
    public void rename(UUID id, String name) { db.find(SceneViewRow.class,id).rename(name); }
    public void delete(UUID id) { db.remove(db.find(SceneViewRow.class,id)); }
}
