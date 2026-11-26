package com.obracota.infrastructure.modelchange.adapters.out.persistence;

import com.obracota.domain.modelchange.port.DoorMinimum;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

public class DoorMinimumAdapter implements DoorMinimum {
    private final JdbcTemplate db;

    public DoorMinimumAdapter(JdbcTemplate db) { this.db = db; }

    @Override
    public Optional<BigDecimal> minimumWidth(UUID project) {
        return db.queryForList("select width_m from door_project_minimum where project_id=?", BigDecimal.class, project).stream().findFirst();
    }

    @Override
    public void minimumWidth(UUID project, BigDecimal width) {
        db.update("delete from door_project_minimum where project_id=?", project);
        db.update("insert into door_project_minimum (project_id, width_m) values (?,?)", project, width);
    }
}
