package com.obracota.infrastructure.sceneview.adapters.out.persistence;

import com.obracota.domain.sceneview.model.SceneView;
import com.obracota.domain.sceneview.model.ViewThumbnail;
import com.obracota.domain.sceneview.port.SceneViewRepository;
import com.obracota.infrastructure.sceneview.adapters.out.persistence.entity.SceneViewRow;
import jakarta.persistence.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import java.util.*;

/**
 * Views go through JPA; their preview bytes go through JDBC so that listing views never loads them.
 */
@Repository
public class SceneViewAdapter implements SceneViewRepository {
    private static final RowMapper<ViewThumbnail> THUMBNAIL=(row,n) -> new ViewThumbnail(row.getBytes(1),row.getString(2));
    @PersistenceContext private EntityManager db;
    private final JdbcTemplate jdbc;
    public SceneViewAdapter(JdbcTemplate jdbc) { this.jdbc=jdbc; }

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
    public void insert(SceneView view, Optional<ViewThumbnail> thumbnail) {
        db.persist(new SceneViewRow(view));
        if (thumbnail.isEmpty()) return;
        db.flush();
        jdbc.update("update scene_view set thumbnail=?, thumbnail_type=? where id=?",thumbnail.get().bytes(),thumbnail.get().type(),view.id());
    }
    public void rename(UUID id, String name) { db.find(SceneViewRow.class,id).rename(name); }
    public void delete(UUID id) { db.remove(db.find(SceneViewRow.class,id)); }
    public Optional<ViewThumbnail> thumbnail(UUID version, UUID id) {
        return jdbc.query("select thumbnail, thumbnail_type from scene_view where version_id=? and id=? and thumbnail is not null",
            THUMBNAIL,version,id).stream().findFirst();
    }
    public Optional<ViewThumbnail> cover(UUID project) {
        // Newest version first (upload time, then revision); inside it, the oldest view with a preview.
        return jdbc.query("""
            select v.thumbnail, v.thumbnail_type from scene_view v
            join model_version m on m.id=v.version_id
            join model_file f on f.id=m.file_id
            where f.project_id=? and v.thumbnail is not null
            order by m.uploaded_at desc, m.revision desc, v.created_at, v.id
            limit 1""",THUMBNAIL,project).stream().findFirst();
    }
}
