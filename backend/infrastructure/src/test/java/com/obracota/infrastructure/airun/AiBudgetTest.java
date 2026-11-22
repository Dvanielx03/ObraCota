package com.obracota.infrastructure.airun;

import com.obracota.application.airun.port.BudgetReservationPort;
import com.obracota.application.airun.usecase.AiBudget;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.Clock;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** R3.1: one monthly cap for every AI feature, 800 cents unless {@code AI_MONTHLY_LIMIT_CENTS} says otherwise. */
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class AiBudgetTest {
    @Autowired AiBudget budget;

    /** In-memory port: counts the locks so the test sees that every reservation takes it. */
    static final class Memory implements BudgetReservationPort {
        final Map<YearMonth, Integer> months = new HashMap<>();
        int locks;
        @Override public void lock() { locks++; }
        @Override public int reserved(YearMonth month) { return months.getOrDefault(month, 0); }
        @Override public void add(YearMonth month, int cents) { months.merge(month, cents, Integer::sum); }
    }

    @Test void theApplicationCapDefaultsTo800() {
        assertEquals(AiBudget.DEFAULT_MONTHLY_LIMIT_CENTS, budget.monthlyLimitCents());
        assertEquals(800, budget.monthlyLimitCents());
    }

    @Test void reservesUnderTheLockUntilTheMonthIsFull() {
        var memory = new Memory();
        var clock = Clock.fixed(Instant.parse("2026-11-30T23:59:00Z"), ZoneOffset.UTC);
        var budget = new AiBudget(memory, 200, clock);
        budget.reserve(100);
        budget.reserve(95);
        assertEquals(5, budget.remaining());
        assertThrows(AiBudget.Exhausted.class, () -> budget.reserve(100));
        budget.reserve(5);
        assertEquals(0, budget.remaining());
        assertThrows(AiBudget.Exhausted.class, () -> budget.reserve(5));
        assertEquals(200, memory.reserved(YearMonth.of(2026, 11)), "a refused reservation adds nothing");
        assertEquals(5, memory.locks, "every reservation, refused or not, takes the lock");
    }

    @Test void eachUtcMonthStartsAgainAndRemainingNeverGoesNegative() {
        var memory = new Memory();
        memory.add(YearMonth.of(2026, 11), 900);
        var november = new AiBudget(memory, 800, Clock.fixed(Instant.parse("2026-11-15T12:00:00Z"), ZoneOffset.UTC));
        assertEquals(0, november.remaining(), "a cap lowered below what is already reserved reads as zero");
        var december = new AiBudget(memory, 800, Clock.fixed(Instant.parse("2026-12-01T00:00:00Z"), ZoneOffset.UTC));
        assertEquals(800, december.remaining());
    }

    @Test void rejectsNonsense() {
        var memory = new Memory();
        assertThrows(IllegalArgumentException.class, () -> new AiBudget(memory, -1, Clock.systemUTC()));
        assertThrows(IllegalArgumentException.class, () -> new AiBudget(memory, 800, Clock.systemUTC()).reserve(0));
    }
}
