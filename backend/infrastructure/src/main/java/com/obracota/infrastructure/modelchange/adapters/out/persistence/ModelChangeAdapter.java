package com.obracota.infrastructure.modelchange.adapters.out.persistence;

import com.obracota.domain.modelchange.model.*;
import com.obracota.domain.modelchange.port.ModelChangeRepository;
import com.obracota.domain.modelchange.port.RecipeCodec;
import com.obracota.domain.security.model.Actor;
import com.obracota.infrastructure.modelchange.adapters.out.json.ReportJson;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

/**
 * {@code model_change} and {@code model_change_event} with JdbcTemplate, as {@code door_change} was (no JPA, so
 * Hibernate's {@code validate} never sees these tables). The recipe is stored canonical; the report and the approved
 * estimate as JSON text, so the same migration runs on H2 and PostgreSQL.
 */
public class ModelChangeAdapter implements ModelChangeRepository {
    /** File, format and project are the base version's (V24, third normal form): read through the join of {@link #SCOPED}. */
    private static final String COLUMNS = """
        m.id, f.project_id, b.file_id, m.base_version, b.format, m.status, m.origin, m.author_id, m.agent_run_id, m.description,
        m.summary, m.recipe, m.report, m.report_recipe_sha256, m.previewed_at, m.preview_id, m.preview_sha256, m.preview_size,
        m.legacy_review, case when m.picture is null then false else true end as picture_present, m.submitted_at, m.applied_version,
        m.applied_at, m.applied_by, m.approved_estimate, m.restored_version, m.restored_at, m.restored_by, m.discarded_at,
        m.discarded_by, m.discarded_by_kind, m.created_at, m.updated_at
        """;
    private static final String SCOPED =
        " from model_change m join model_version b on b.id = m.base_version join model_file f on f.id = b.file_id";
    /** The versions of one project, for writes that must stay inside it. */
    private static final String PROJECT_VERSIONS =
        "select v.id from model_version v join model_file pf on pf.id = v.file_id where pf.project_id = ?";
    private static final List<String> PENDING = List.of(ChangeStatus.DRAFT.name(), ChangeStatus.READY.name());

    private final JdbcTemplate db;
    private final NamedParameterJdbcTemplate named;
    private final RecipeCodec recipes;
    private final ReportJson reports = new ReportJson();

    public ModelChangeAdapter(JdbcTemplate db, RecipeCodec recipes) {
        this.db = db;
        this.named = new NamedParameterJdbcTemplate(db);
        this.recipes = recipes;
    }

    @Override
    public Optional<ModelChange> find(UUID project, UUID id) {
        return db.query("select " + COLUMNS + SCOPED + " where f.project_id=? and m.id=?", this::row, project, id).stream().findFirst();
    }

    /** {@code ProjectJpaRepository.lockOwned} is a {@code PESSIMISTIC_WRITE} on this same row, without the owner. */
    @Override
    public Optional<ModelChange> findLockingProject(UUID project, UUID id) {
        if (db.query("select id from project where id=? for update", (rs, n) -> rs.getObject(1, UUID.class), project).isEmpty())
            return Optional.empty();
        return find(project, id);
    }

    @Override
    public List<ModelChange> list(UUID project, Set<ChangeStatus> statuses, UUID file, int limit) {
        var sql = new StringBuilder("select ").append(COLUMNS).append(SCOPED).append(" where f.project_id=:project");
        var params = new MapSqlParameterSource("project", project);
        if (statuses != null && !statuses.isEmpty()) {
            sql.append(" and m.status in (:statuses)");
            params.addValue("statuses", statuses.stream().map(Enum::name).toList());
        }
        if (file != null) {
            sql.append(" and b.file_id=:file");
            params.addValue("file", file);
        }
        sql.append(" order by m.created_at desc, m.id");
        if (limit > 0 && limit < Integer.MAX_VALUE) {
            sql.append(" limit :limit");
            params.addValue("limit", limit);
        }
        return named.query(sql.toString(), params, this::row);
    }

    @Override
    public List<ModelChange> pending(UUID project, UUID file) {
        return named.query("select " + COLUMNS + SCOPED + " where f.project_id=:project and b.file_id=:file and m.status in (:pending)"
            + " order by m.created_at", new MapSqlParameterSource("project", project).addValue("file", file).addValue("pending", PENDING), this::row);
    }

    @Override
    public List<ModelChange> holdingPreviews() {
        return named.query("select " + COLUMNS + SCOPED + " where m.status in (:pending) and m.preview_id is not null order by m.created_at",
            new MapSqlParameterSource("pending", PENDING), this::row);
    }

    @Override
    public void insert(ModelChange change, byte[] picture) {
        db.update("""
            insert into model_change (id, base_version, status, origin, author_id, agent_run_id,
              description, summary, recipe, report, report_recipe_sha256, previewed_at, preview_id, preview_sha256, preview_size,
              legacy_review, picture, submitted_at, applied_version, applied_at, applied_by, approved_estimate, restored_version,
              restored_at, restored_by, discarded_at, discarded_by, discarded_by_kind, created_at, updated_at)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, statement -> {
            int i = 1;
            statement.setObject(i++, change.id());
            statement.setObject(i++, change.baseVersion());
            i = fields(statement, i, change);
            if (picture == null) statement.setNull(i, Types.BINARY); else statement.setBytes(i, picture);
            i++;
            i = published(statement, i, change);
            statement.setObject(i++, time(change.createdAt()));
            statement.setObject(i, time(change.updatedAt()));
        });
    }

    @Override
    public void update(ModelChange change) {
        int rows = db.update("""
            update model_change set status=?, origin=?, author_id=?, agent_run_id=?, description=?, summary=?, recipe=?, report=?,
              report_recipe_sha256=?, previewed_at=?, preview_id=?, preview_sha256=?, preview_size=?, legacy_review=?,
              submitted_at=?, applied_version=?, applied_at=?, applied_by=?, approved_estimate=?, restored_version=?, restored_at=?,
              restored_by=?, discarded_at=?, discarded_by=?, discarded_by_kind=?, updated_at=?
            where id=? and base_version in (%s)
            """.formatted(PROJECT_VERSIONS), statement -> {
            int i = fields(statement, 1, change);
            i = published(statement, i, change);
            statement.setObject(i++, time(change.updatedAt()));
            statement.setObject(i++, change.id());
            statement.setObject(i, change.project());
        });
        if (rows != 1) throw new IllegalStateException("Model change " + change.id() + " does not exist");
    }

    /** status … legacy_review. */
    private int fields(java.sql.PreparedStatement s, int i, ModelChange c) throws SQLException {
        s.setString(i++, c.status().name());
        s.setString(i++, c.origin().name());
        s.setObject(i++, c.author());
        s.setObject(i++, c.agentRun());
        s.setString(i++, c.description());
        s.setString(i++, c.summary());
        s.setString(i++, recipes.canonical(c.recipe()));
        s.setString(i++, c.report() == null ? null : reports.write(c.report()));
        s.setString(i++, c.reportRecipeSha256());
        s.setObject(i++, time(c.previewedAt()));
        var preview = c.preview();
        s.setObject(i++, preview == null ? null : preview.id());
        s.setString(i++, preview == null ? null : preview.sha256());
        if (preview == null) s.setNull(i++, Types.BIGINT); else s.setLong(i++, preview.size());
        s.setString(i++, c.legacyReview());
        return i;
    }

    /** submitted_at … discarded_by_kind. */
    private int published(java.sql.PreparedStatement s, int i, ModelChange c) throws SQLException {
        s.setObject(i++, time(c.submittedAt()));
        var applied = c.applied();
        s.setObject(i++, applied == null ? null : applied.version());
        s.setObject(i++, applied == null ? null : time(applied.at()));
        s.setObject(i++, applied == null ? null : applied.by());
        s.setString(i++, c.approvedEstimate() == null ? null : reports.write(c.approvedEstimate()));
        var restored = c.restored();
        s.setObject(i++, restored == null ? null : restored.version());
        s.setObject(i++, restored == null ? null : time(restored.at()));
        s.setObject(i++, restored == null ? null : restored.by());
        var discarded = c.discarded();
        s.setObject(i++, discarded == null ? null : time(discarded.at()));
        s.setObject(i++, discarded == null ? null : discarded.by());
        s.setString(i++, discarded == null ? null : discarded.kind().name());
        return i;
    }

    @Override
    public void record(ModelChangeEvent event) {
        db.update("insert into model_change_event (change_id, action, actor_kind, actor_user, agent_run_id, detail, created_at) values (?,?,?,?,?,?,?)",
            event.change(), event.action().name(), event.actorKind().name(), event.actorUser(), event.agentRun(), event.detail(), time(event.at()));
    }

    @Override
    public List<ModelChangeEvent> events(UUID change) {
        return db.query("select change_id, action, actor_kind, actor_user, agent_run_id, detail, created_at from model_change_event"
            + " where change_id=? order by created_at, id", (rs, n) -> new ModelChangeEvent(rs.getObject(1, UUID.class),
            ModelChangeEvent.Action.valueOf(rs.getString(2)), ModelChangeEvent.ActorKind.valueOf(rs.getString(3)),
            rs.getObject(4, UUID.class), rs.getObject(5, UUID.class), rs.getString(6), instant(rs, 7)), change);
    }

    @Override
    public Optional<byte[]> picture(UUID project, UUID id) {
        return db.query("select m.picture" + SCOPED + " where f.project_id=? and m.id=? and m.picture is not null",
            (rs, n) -> rs.getBytes(1), project, id).stream().findFirst();
    }

    @Override
    public Map<UUID, String> emails(Collection<UUID> users) {
        if (users.isEmpty()) return Map.of();
        var found = new HashMap<UUID, String>();
        named.query("select id, email from security_user where id in (:users)", new MapSqlParameterSource("users", List.copyOf(users)),
            (org.springframework.jdbc.core.RowCallbackHandler) rs -> found.put(rs.getObject(1, UUID.class), rs.getString(2)));
        return found;
    }

    private ModelChange row(ResultSet rs, int index) throws SQLException {
        var reportText = rs.getString("report");
        var previewId = rs.getObject("preview_id", UUID.class);
        var appliedAt = instant(rs, "applied_at");
        var restoredAt = instant(rs, "restored_at");
        var discardedAt = instant(rs, "discarded_at");
        var estimate = rs.getString("approved_estimate");
        var kind = rs.getString("discarded_by_kind");
        return new ModelChange(rs.getObject("id", UUID.class), rs.getObject("project_id", UUID.class), rs.getObject("file_id", UUID.class),
            rs.getObject("base_version", UUID.class), rs.getString("format"), ChangeStatus.valueOf(rs.getString("status")),
            ChangeOrigin.valueOf(rs.getString("origin")), rs.getObject("author_id", UUID.class), rs.getObject("agent_run_id", UUID.class),
            rs.getString("description"), rs.getString("summary"), recipes.recipe(rs.getString("recipe")),
            reportText == null ? null : reports.report(reportText), rs.getString("report_recipe_sha256"), instant(rs, "previewed_at"),
            previewId == null ? null : new ModelChange.Preview(previewId, rs.getString("preview_sha256"), rs.getLong("preview_size")),
            rs.getString("legacy_review"), rs.getBoolean("picture_present"), instant(rs, "submitted_at"),
            appliedAt == null ? null : new ModelChange.Publication(rs.getObject("applied_version", UUID.class), appliedAt, rs.getObject("applied_by", UUID.class)),
            estimate == null ? null : reports.estimate(estimate),
            restoredAt == null ? null : new ModelChange.Publication(rs.getObject("restored_version", UUID.class), restoredAt, rs.getObject("restored_by", UUID.class)),
            discardedAt == null ? null : new ModelChange.Discard(discardedAt, rs.getObject("discarded_by", UUID.class), Actor.Kind.valueOf(kind)),
            instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static OffsetDateTime time(Instant instant) { return instant == null ? null : instant.atOffset(ZoneOffset.UTC); }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        var value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        var value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
