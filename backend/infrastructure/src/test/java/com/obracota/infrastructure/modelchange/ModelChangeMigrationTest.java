package com.obracota.infrastructure.modelchange;

import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import com.obracota.infrastructure.modelchange.adapters.out.persistence.ModelChangeAdapter;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * J5 (§3.5): the history of {@code door_change} is still readable after V15 and after V18 drops the legacy tables, without Spring. It runs on its own H2
 * database and, when {@code -Dmigration.postgres-url} is given, again on a throwaway PostgreSQL 17.
 */
class ModelChangeMigrationTest {
    static final String DOOR = "1hOSvn6df7F8_7GcBWlS8Z", TYPE = "2klOFZffH6WQFlV10uM1wF";

    @Test void migratesTheDoorHistoryOnH2() {
        var data = new DriverManagerDataSource("jdbc:h2:mem:migracion-" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        migrateAndCheck(data, "classpath:db/migration");
    }

    @Test void migratesTheDoorHistoryOnPostgres() {
        var url = System.getProperty("migration.postgres-url");
        Assumptions.assumeTrue(url != null && !url.isBlank(),
            "PostgreSQL skipped: pass -Dmigration.postgres-url (and -Dmigration.postgres-password) to run it (§3.5).");
        var data = new DriverManagerDataSource(url, System.getProperty("migration.postgres-user", "postgres"),
            System.getProperty("migration.postgres-password", ""));
        migrateAndCheck(data, "classpath:db/migration", "classpath:db/postgresql");
    }

    private void migrateAndCheck(DataSource data, String... locations) {
        flyway(data, "14", locations).migrate();
        var db = new JdbcTemplate(data);
        UUID user = UUID.randomUUID(), project = UUID.randomUUID(), file = UUID.randomUUID();
        UUID base = UUID.randomUUID(), applied = UUID.randomUUID(), restored = UUID.randomUUID();
        UUID pending = UUID.randomUUID(), published = UUID.randomUUID(), reverted = UUID.randomUUID();
        var t0 = OffsetDateTime.of(2026, 11, 1, 10, 0, 0, 0, ZoneOffset.UTC);
        db.update("insert into security_user (id,email,password_hash,role) values (?,?,?,?)", user, "ingeniera@example.test", "x", "USER");
        UUID applier = UUID.randomUUID(), restorer = UUID.randomUUID();
        db.update("insert into security_user (id,email,password_hash,role) values (?,?,?,?)", applier, "aplica@example.test", "x", "USER");
        db.update("insert into security_user (id,email,password_hash,role) values (?,?,?,?)", restorer, "restaura@example.test", "x", "USER");
        db.update("insert into project (id,owner_id,name,created_at,updated_at) values (?,?,?,?,?)", project, user, "Migración", t0, t0);
        db.update("insert into model_file (id,project_id,name,format) values (?,?,?,?)", file, project, "Duplex.ifc", "IFC");
        version(db, base, file, 1, user, t0);
        version(db, applied, file, 2, applier, t0.plusHours(1));
        version(db, restored, file, 3, restorer, t0.plusHours(2));
        door(db, pending, project, base, user, null, null, null, t0.plusMinutes(10));
        door(db, published, project, base, user, applied, t0.plusHours(1), null, t0.plusMinutes(20));
        door(db, reverted, project, base, user, applied, t0.plusHours(1), restored, t0.plusMinutes(30));
        db.update("insert into door_unit_price values (?,?,?,?,?,?)", project, base, TYPE, new BigDecimal("125000.00"), "Cotización de prueba",
            java.time.LocalDate.of(2026, 11, 20));

        flyway(data, "15", locations).migrate();

        assertEquals("DRAFT", status(db, pending));
        assertEquals("APPLIED", status(db, published));
        assertEquals("RESTORED", status(db, reverted));
        assertEquals(applier, db.queryForObject("select applied_by from model_change where id=?", UUID.class, published));
        assertEquals(applier, db.queryForObject("select applied_by from model_change where id=?", UUID.class, reverted));
        assertEquals(restorer, db.queryForObject("select restored_by from model_change where id=?", UUID.class, reverted));
        assertNotNull(db.queryForObject("select restored_at from model_change where id=?", OffsetDateTime.class, reverted));
        assertNull(db.queryForObject("select submitted_at from model_change where id=?", OffsetDateTime.class, pending));
        assertEquals("{\"format\":\"obracota.recipe/1\",\"operations\":[{\"id\":\"op-1\",\"op\":\"ifc.change_type\",\"element\":\"" + DOOR
            + "\",\"type_id\":\"" + TYPE + "\"}]}", db.queryForObject("select recipe from model_change where id=?", String.class, pending));
        assertEquals(6, db.queryForObject("select count(*) from model_change_event where change_id in (?,?,?)", Integer.class, pending, published, reverted));
        assertEquals(3, count(db, "CREATE"));
        assertEquals(2, count(db, "APPLY"));
        assertEquals(1, count(db, "RESTORE"));
        assertEquals(0, db.queryForObject("""
            select count(*) from model_change_event e join model_change c on c.id=e.change_id
            where (e.action='APPLY' and e.actor_user<>c.applied_by) or (e.action='RESTORE' and e.actor_user<>c.restored_by)""", Integer.class));
        assertEquals(applier, db.queryForObject("select actor_user from model_change_event where change_id=? and action='APPLY'", UUID.class, published));
        assertEquals(1, db.queryForObject("select count(*) from unit_price where price_key=? and unit='UNIT' and currency='COP'", Integer.class, "type:" + TYPE));
        assertEquals(3, db.queryForObject("select count(*) from door_change", Integer.class));
        assertEquals(1, db.queryForObject("select count(*) from door_unit_price", Integer.class));
        assertEquals("{\"door\":{}}", db.queryForObject("select review from door_change where id=?", String.class, pending));

        // J5: the production adapters read the migrated rows.
        var codec = new JacksonRecipeCodec();
        var changes = new ModelChangeAdapter(db, codec);
        var draft = changes.find(project, pending).orElseThrow();
        assertEquals(ChangeStatus.DRAFT, draft.status());
        assertEquals("{\"door\":{}}", draft.legacyReview());
        assertNull(draft.report());
        assertEquals(new ChangeType("op-1", DOOR, TYPE), draft.recipe().operations().getFirst());
        var restoredChange = changes.find(project, reverted).orElseThrow();
        assertEquals(restored, restoredChange.restored().version());
        assertEquals(restorer, restoredChange.restored().by());
        assertEquals(applied, restoredChange.applied().version());
        assertEquals(3, changes.list(project, Set.of(), null, 100).size());
        assertEquals(List.of(reverted, published, pending), changes.list(project, Set.of(), null, 100).stream().map(c -> c.id()).toList());
        assertEquals(1, changes.pending(project, file).size());
        assertEquals(3, changes.events(reverted).size());
        assertEquals(Map.of(user, "ingeniera@example.test"), changes.emails(List.of(user)));

        UUID historicalRun = UUID.randomUUID(), historicalChange = UUID.randomUUID();
        db.update("""
            insert into model_change(id,project_id,file_id,base_version,format,status,origin,author_id,agent_run_id,
                description,recipe,created_at,updated_at)
            select ?,project_id,file_id,base_version,format,'DRAFT','AGENT',author_id,?,description,recipe,created_at,updated_at
            from model_change where id=?
            """, historicalChange, historicalRun, pending);

        // V18 retires the door tables. V20 records the older link without inferring its outcome.
        flyway(data, "latest", locations).migrate();
        assertFalse(table(db, "door_change"));
        assertFalse(table(db, "door_unit_price"));
        assertEquals(1, db.queryForObject("select count(*) from unit_price where version_id=?", Integer.class, base));
        assertTrue(table(db, "door_project_minimum"));
        assertEquals(4, changes.list(project, Set.of(), null, 100).size());
        assertEquals("{\"door\":{}}", changes.find(project, pending).orElseThrow().legacyReview());
        var history = new com.obracota.infrastructure.agent.adapters.out.persistence.JdbcAgentRunHistory(db);
        var run = history.list(project, user, base, historicalChange).getFirst();
        assertEquals(historicalRun, run.id());
        assertEquals("LEGACY", run.status().name());
        assertEquals("unknown", run.provider());
        assertNull(run.finishedAt());
    }

    private static boolean table(JdbcTemplate db, String name) {
        return db.queryForObject("select count(*) from information_schema.tables where lower(table_name)=?", Integer.class, name) > 0;
    }

    private static Flyway flyway(DataSource data, String target, String... locations) {
        return Flyway.configure().dataSource(data).locations(locations).target(target).load();
    }

    private static void version(JdbcTemplate db, UUID id, UUID file, int revision, UUID by, OffsetDateTime at) {
        db.update("insert into model_version (id,file_id,revision,name,format,byte_size,sha256,uploaded_at,uploaded_by,uploader_email) values (?,?,?,?,?,?,?,?,?,?)",
            id, file, revision, "Duplex.ifc", "IFC", 13L, "0".repeat(63) + revision, at, by, "x@example.test");
    }

    private static void door(JdbcTemplate db, UUID id, UUID project, UUID base, UUID author, UUID applied, OffsetDateTime appliedAt,
                             UUID restored, OffsetDateTime created) {
        db.update("insert into door_change (id,project_id,base_version,author_id,element_key,type_key,description,picture,review,applied_version,restored_version,created_at,applied_at)"
            + " values (?,?,?,?,?,?,?,?,?,?,?,?,?)", id, project, base, author, DOOR, TYPE, "Puerta alternativa", null, "{\"door\":{}}",
            applied, restored, created, appliedAt);
    }

    private static String status(JdbcTemplate db, UUID id) {
        return db.queryForObject("select status from model_change where id=?", String.class, id);
    }

    private static int count(JdbcTemplate db, String action) {
        return db.queryForObject("select count(*) from model_change_event where action=?", Integer.class, action);
    }
}
