package com.obracota.infrastructure.airun;

import com.obracota.application.airun.port.BudgetReservationPort;
import java.time.YearMonth;
import org.springframework.jdbc.core.JdbcTemplate;

/** {@link BudgetReservationPort} on {@code ai_budget_lock} (one row, locked with {@code for update}) and {@code ai_month_budget}. */
public class JdbcBudgetReservation implements BudgetReservationPort {
    private final JdbcTemplate db;

    public JdbcBudgetReservation(JdbcTemplate db) { this.db = db; }

    @Override
    public void lock() {
        db.queryForObject("select id from ai_budget_lock where id=1 for update", Integer.class);
    }

    @Override
    public int reserved(YearMonth month) {
        return db.queryForObject("select coalesce(sum(reserved_cents),0) from ai_month_budget where month_key=?",
            Integer.class, month.toString());
    }

    @Override
    public void add(YearMonth month, int cents) {
        // Read and written under the lock, so no two reservations race on the insert.
        if (db.update("update ai_month_budget set reserved_cents=reserved_cents+? where month_key=?", cents, month.toString()) == 0)
            db.update("insert into ai_month_budget(month_key,reserved_cents) values(?,?)", month.toString(), cents);
    }
}
