package com.obracota.infrastructure.designoption.adapters.out;

import com.obracota.application.designoption.port.DesignOptionBatches;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** {@link DesignOptionBatches} on {@code design_option_batch}, {@code design_option_description}, {@code design_option} and {@code ai_run}. */
public class DesignOptionBatchAdapter implements DesignOptionBatches {
    private final JdbcTemplate db;

    public DesignOptionBatchAdapter(JdbcTemplate db) { this.db = db; }

    @Override
    public boolean exists(UUID id, UUID version, UUID owner, String element, String request) {
        return !db.queryForList("select id from design_option_batch where id=? and version_id=? and owner_id=? and element_key=? and description=?",
            UUID.class, id, version, owner, element, request).isEmpty();
    }

    @Override
    public void queue(NewBatch batch) {
        db.update("insert into design_option_batch(id,version_id,owner_id,element_key,element_name,description,captured,state,created_at) values(?,?,?,?,?,?,?,'QUEUED',current_timestamp)",
            batch.id(), batch.version(), batch.owner(), batch.element(), batch.name(), batch.request(), batch.captured());
        if (batch.mask() != null) db.update("update design_option_batch set selection_mask=? where id=?", batch.mask(), batch.id());
    }

    @Override
    public boolean belongs(UUID version, UUID id) {
        return !db.queryForList("select id from design_option_batch where version_id=? and id=?", UUID.class, version, id).isEmpty();
    }

    @Override
    public List<Map<String, Object>> list(UUID version, String element) {
        var batches = db.query("select id,description,state,selected_slot,selection_mask is not null from design_option_batch where version_id=? and element_key=? order by created_at desc",
            (r, n) -> {
                var b = new LinkedHashMap<String, Object>();
                b.put("id", r.getString(1));
                b.put("request", r.getString(2));
                b.put("state", r.getString(3));
                b.put("selected", r.getObject(4));
                b.put("hasMask", r.getBoolean(5));
                return b;
            }, version, element);
        for (var b : batches) {
            UUID id = UUID.fromString((String) b.get("id"));
            b.put("drafts", db.queryForList("select description from design_option_description where batch_id=? order by slot", String.class, id));
            b.put("options", db.query("select slot,description from design_option where batch_id=? order by slot",
                (r, n) -> Map.of("slot", r.getInt(1), "description", r.getString(2)), id));
            b.put("runs", db.query("select slot, model_id, status, error_code, input_tokens,output_tokens,total_tokens from ai_run where batch_id=? order by slot",
                (r, n) -> {
                    var run = new LinkedHashMap<String, Object>();
                    run.put("slot", r.getInt(1));
                    run.put("model_id", r.getString(2));
                    run.put("status", r.getString(3));
                    run.put("error_code", r.getString(4));
                    run.put("input_tokens", r.getObject(5));
                    run.put("output_tokens", r.getObject(6));
                    run.put("total_tokens", r.getObject(7));
                    return run;
                }, id));
        }
        return List.copyOf(batches);
    }

    @Override
    public Optional<Binary> captured(UUID id) {
        return db.query("select captured,'image/jpeg' from design_option_batch where id=?", DesignOptionBatchAdapter::binary, id).stream().findFirst();
    }

    @Override
    public Optional<Binary> mask(UUID id) {
        return db.query("select selection_mask,'image/jpeg' from design_option_batch where id=? and selection_mask is not null",
            DesignOptionBatchAdapter::binary, id).stream().findFirst();
    }

    @Override
    public Optional<Binary> image(UUID id, int slot) {
        return db.query("select image_bytes,mime from design_option where batch_id=? and slot=?", DesignOptionBatchAdapter::binary, id, slot)
            .stream().findFirst();
    }

    @Override
    public boolean select(UUID id, int slot) {
        return db.update("update design_option_batch set selected_slot=?,selected_at=current_timestamp where id=? and state='READY' and exists(select 1 from design_option where batch_id=? and slot=?)",
            slot, id, id, slot) == 1;
    }

    private static Binary binary(ResultSet r, int n) throws SQLException {
        return new Binary(r.getBytes(1), r.getString(2));
    }
}
