package com.obracota.infrastructure.agent.adapters.out.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.agent.port.AgentToolJournal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** {@link AgentToolJournal} on {@code agent_tool_call} (V15). Arguments and results are stored as JSON, the result cut at 20,000 characters. */
public class JdbcAgentToolJournal implements AgentToolJournal {
    static final int RESULT_LIMIT = 20_000;
    private static final TypeReference<LinkedHashMap<String, Object>> TREE = new TypeReference<>() {};

    private final JdbcTemplate db;
    private final ObjectMapper json;

    public JdbcAgentToolJournal(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    @Override
    public void record(Entry entry) {
        var result = entry.result() == null ? null : write(entry.result());
        if (result != null && result.length() > RESULT_LIMIT) result = result.substring(0, RESULT_LIMIT);
        db.update("insert into agent_tool_call(run_id,step,seq,project_id,user_id,change_id,tool,arguments,result,status,error_code,duration_ms,created_at) "
                + "values(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            entry.run(), entry.step(), entry.seq(), entry.project(), entry.user(), entry.change(), entry.tool(),
            write(entry.arguments() == null ? Map.of() : entry.arguments()), result, entry.status().name(),
            entry.errorCode() == null ? null : entry.errorCode().substring(0, Math.min(80, entry.errorCode().length())),
            entry.durationMs(), Timestamp.from(Instant.now()));
    }

    @Override
    public List<Entry> list(UUID project, UUID user, UUID run) {
        return db.query("select run_id,step,seq,project_id,user_id,change_id,tool,arguments,result,status,error_code,duration_ms "
                + "from agent_tool_call where run_id=? and project_id=? and user_id=? order by step,seq",
            (row, n) -> new Entry(row.getObject(1, UUID.class), row.getInt(2), row.getInt(3), row.getObject(4, UUID.class),
                row.getObject(5, UUID.class), row.getObject(6, UUID.class), row.getString(7), read(row.getString(8)), read(row.getString(9)),
                Status.valueOf(row.getString(10)), row.getString(11), row.getInt(12)),
            run, project, user);
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            return "{}";
        }
    }

    private Map<String, Object> read(String text) {
        if (text == null) return null;
        try {
            return json.readValue(text, TREE);
        } catch (Exception e) {
            return Map.of();
        }
    }
}
