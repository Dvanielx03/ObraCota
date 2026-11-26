package com.obracota.infrastructure.modelversion.adapters.out.sample;

import com.obracota.application.modelversion.port.SampleProjects;
import com.obracota.application.modelversion.usecase.SampleScopes.SampleModel;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code project.sample} with its file and version, written with JdbcTemplate (the JPA project entity never sets it). */
@Repository
public class SampleProjectAdapter implements SampleProjects {
    private final JdbcTemplate db;

    public SampleProjectAdapter(JdbcTemplate db) { this.db = db; }

    @Override
    public Optional<Scope> find(UUID owner, String sample) {
        return db.query("""
            select p.id, v.id from project p join model_file f on f.project_id=p.id join model_version v on v.file_id=f.id
            where p.owner_id=? and p.sample=? order by v.revision desc""",
            (rs, n) -> new Scope(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class)), owner, sample).stream().findFirst();
    }

    @Override
    public Scope create(UUID owner, SampleModel sample) {
        var project = UUID.randomUUID();
        var file = UUID.randomUUID();
        var version = UUID.randomUUID();
        var now = OffsetDateTime.now(ZoneOffset.UTC);
        try {
            db.update("insert into project (id, owner_id, name, created_at, updated_at, archived, sample) values (?,?,?,?,?,false,?)",
                project, owner, sample.projectName(), now, now, sample.key());
        } catch (DataIntegrityViolationException | ConcurrencyFailureException taken) {
            // The unique (owner_id, sample): another request of the same person inserted it first.
            throw new Taken(taken);
        }
        db.update("insert into model_file (id, project_id, name, format) values (?,?,?,?)", file, project, sample.fileName(), sample.format());
        db.update("""
            insert into model_version (id, file_id, revision, name, format, byte_size, sha256, uploaded_at, uploaded_by)
            values (?,?,1,?,?,?,?,?,?)""",
            version, file, sample.fileName(), sample.format(), sample.byteSize(), sample.sha256(), now, owner);
        return new Scope(project, version);
    }
}
