package com.obracota.application.airun.port;

import java.time.YearMonth;

/**
 * The monthly AI budget as it is stored: one counter of reserved cents per UTC month, behind a single lock row. Every
 * call runs inside the caller's transaction; {@link #lock()} holds the lock until that transaction ends.
 */
public interface BudgetReservationPort {
    /** Takes the budget lock (pessimistic) for the rest of the open transaction. */
    void lock();

    /** Cents already reserved in {@code month}; 0 when nothing was reserved yet. */
    int reserved(YearMonth month);

    /** Adds {@code cents} to the counter of {@code month}, creating it when it does not exist. */
    void add(YearMonth month, int cents);
}
