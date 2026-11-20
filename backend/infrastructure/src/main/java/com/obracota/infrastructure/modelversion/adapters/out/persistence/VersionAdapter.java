package com.obracota.infrastructure.modelversion.adapters.out.persistence;

import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.modelversion.port.VersionRepository;
import com.obracota.infrastructure.modelversion.adapters.out.persistence.entity.*;
import jakarta.persistence.*;
import org.springframework.stereotype.Repository;
import java.util.*;
import java.util.stream.Collectors;

@Repository
public class VersionAdapter implements VersionRepository {
    @PersistenceContext private EntityManager db;
    public void insert(ModelVersion v) { db.persist(new VersionRow(v)); }
    public List<ModelVersion> history(UUID file) {
        return db.createQuery("from VersionRow where fileId=:file order by revision desc",VersionRow.class)
            .setParameter("file",file).getResultList().stream().map(VersionRow::toDomain).toList();
    }
    public int nextRevision(UUID file) {
        return db.createQuery("select coalesce(max(revision),0) from VersionRow where fileId=:file",Integer.class)
            .setParameter("file",file).getSingleResult()+1;
    }
    public Optional<ModelVersion> find(UUID project,UUID id) {
        return db.createQuery("select v from VersionRow v, ModelFileJpaEntity f where f.id=v.fileId and f.projectId=:project and v.id=:id",VersionRow.class)
            .setParameter("project",project).setParameter("id",id).getResultList().stream().findFirst().map(VersionRow::toDomain);
    }
    public Map<String,String> notes(UUID version) {
        return db.createQuery("from ObservationRow where versionId=:id order by elementKey",ObservationRow.class)
            .setParameter("id",version).getResultList().stream().collect(Collectors.toMap(ObservationRow::key,ObservationRow::text));
    }
    public void writeNote(UUID version,String key,String text,boolean onlyIfAbsent) {
        db.find(VersionRow.class,version,LockModeType.PESSIMISTIC_WRITE);
        var row=db.createQuery("from ObservationRow where versionId=:id and elementKey=:key",ObservationRow.class)
            .setParameter("id",version).setParameter("key",key).getResultList().stream().findFirst();
        if(onlyIfAbsent && row.isPresent()) return;
        if(text.isEmpty()) row.ifPresent(db::remove);
        else if(row.isPresent()) row.get().replace(text);
        else db.persist(new ObservationRow(version,key,text));
    }
}
