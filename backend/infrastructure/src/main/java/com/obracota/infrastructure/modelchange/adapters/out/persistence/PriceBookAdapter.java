package com.obracota.infrastructure.modelchange.adapters.out.persistence;

import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.port.PriceBook;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** {@code unit_price} (per version, with source, date and copy origin) and {@code door_project_minimum}, with JdbcTemplate. */
public class PriceBookAdapter implements PriceBook {
    private final JdbcTemplate db;

    public PriceBookAdapter(JdbcTemplate db) { this.db = db; }

    @Override
    public List<UnitPrice> prices(UUID project, UUID version) {
        // The project is the version's (V24): the key of a price is (version_id, price_key).
        return db.query("select p.price_key, p.unit, p.currency, p.amount, p.source, p.price_date, p.copied_from from unit_price p"
                + " join model_version v on v.id=p.version_id join model_file f on f.id=v.file_id"
                + " where f.project_id=? and p.version_id=? order by p.price_key",
            (rs, n) -> new UnitPrice(new PriceKey(rs.getString(1)), UnitPrice.Unit.valueOf(rs.getString(2)), rs.getString(3),
                rs.getBigDecimal(4), rs.getString(5), rs.getObject(6, LocalDate.class), rs.getObject(7, UUID.class)), project, version);
    }

    @Override
    public void put(UUID project, UUID version, UnitPrice price) {
        db.update("delete from unit_price where version_id=? and price_key=?", version, price.key().value());
        db.update("insert into unit_price (version_id, price_key, unit, currency, amount, source, price_date, copied_from, updated_at)"
                + " values (?,?,?,?,?,?,?,?,?)", version, price.key().value(), price.unit().name(), price.currency(),
            price.amount(), price.source(), price.date(), price.copiedFrom(), OffsetDateTime.now(ZoneOffset.UTC));
    }

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
