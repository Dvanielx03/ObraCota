package com.obracota.application.airun.usecase;

import com.obracota.application.airun.port.BudgetReservationPort;
import java.time.Clock;
import java.time.YearMonth;

/**
 * The single monthly AI cap shared by every feature that calls a paid provider. A reservation is taken before the call
 * and never returned: a failed or uncertain call still counts, so the cap is never exceeded by a retry.
 *
 * <p>{@link #reserve(int)} and {@link #lock()} must run inside the caller's transaction, which keeps the lock until the
 * work that depends on the reservation is stored too.
 */
public final class AiBudget {
    /** Default cap in cents when nothing is configured. */
    public static final int DEFAULT_MONTHLY_LIMIT_CENTS = 800;

    private final BudgetReservationPort budget;
    private final int monthlyLimitCents;
    private final Clock clock;

    public AiBudget(BudgetReservationPort budget, int monthlyLimitCents, Clock clock) {
        if (monthlyLimitCents < 0) throw new IllegalArgumentException("The monthly AI limit cannot be negative");
        this.budget = budget;
        this.monthlyLimitCents = monthlyLimitCents;
        this.clock = clock;
    }

    public int monthlyLimitCents() { return monthlyLimitCents; }

    /** Cents still available this UTC month, never below zero. Read without the lock: only a hint for the client. */
    public int remaining() {
        return Math.max(0, monthlyLimitCents - budget.reserved(month()));
    }

    /** Takes the budget lock without reserving, for work that must decide under it whether to reserve at all. */
    public void lock() { budget.lock(); }

    /**
     * Reserves {@code cents} of this month's budget under the lock.
     *
     * @throws Exhausted when fewer than {@code cents} remain; nothing is reserved then
     */
    public void reserve(int cents) {
        if (cents <= 0) throw new IllegalArgumentException("A reservation must be positive");
        budget.lock();
        var month = month();
        if (monthlyLimitCents - budget.reserved(month) < cents) throw new Exhausted();
        budget.add(month, cents);
    }

    private YearMonth month() { return YearMonth.now(clock.withZone(java.time.ZoneOffset.UTC)); }

    /** The month has no room for the reservation. Each caller turns it into its own 429 message. */
    public static final class Exhausted extends RuntimeException {
        public Exhausted() { super("Monthly AI budget exhausted"); }
    }
}
