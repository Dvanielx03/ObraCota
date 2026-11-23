package com.obracota.infrastructure.agent.adapters.out.persistence;

import com.obracota.application.agent.port.AgentRunHistory;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

public class JdbcAgentRunHistory implements AgentRunHistory {
    private final JdbcTemplate db;

    public JdbcAgentRunHistory(JdbcTemplate db) {
        this.db = db;
    }

    @Override
    public void start(UUID id, UUID project, UUID version, UUID user, String provider, String model) {
        db.update("insert into agent_run(id,project_id,version_id,user_id,provider,model,status,message,started_at) values (?,?,?,?,?,?,?,?,?)",
            id, project, version, user, provider, model, Status.RUNNING.name(), "El agente está preparando el cambio.",
            Timestamp.from(Instant.now()));
    }

    @Override
    public void finish(UUID id, Status status, String message, UUID change) {
        db.update("update agent_run set status=?,message=?,change_id=?,finished_at=? where id=? and status='RUNNING'",
            status.name(), message, change, Timestamp.from(Instant.now()), id);
    }

    @Override
    public List<Run> list(UUID project, UUID user, UUID version, UUID change) {
        var sql = new StringBuilder("""
            select id,project_id,version_id,user_id,provider,model,status,message,change_id,started_at,finished_at
            from agent_run where project_id=? and user_id=?
            """);
        var args = new ArrayList<Object>(List.of(project, user));
        if (version != null) {
            sql.append(" and version_id=?");
            args.add(version);
        }
        if (change != null) {
            sql.append(" and change_id=?");
            args.add(change);
        }
        sql.append(" order by started_at desc, id desc limit 20");
        return db.query(sql.toString(), (row, n) -> {
            var completed = row.getTimestamp("finished_at");
            return new Run(row.getObject("id", UUID.class), row.getObject("project_id", UUID.class), row.getObject("version_id", UUID.class),
                row.getObject("user_id", UUID.class), row.getString("provider"), row.getString("model"), Status.valueOf(row.getString("status")),
                row.getString("message"), row.getObject("change_id", UUID.class), row.getTimestamp("started_at").toInstant(),
                completed == null ? null : completed.toInstant());
        }, args.toArray());
    }
}
