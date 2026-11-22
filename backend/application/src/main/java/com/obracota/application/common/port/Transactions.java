package com.obracota.application.common.port;

/**
 * Transaction boundary owned by the use cases. Work that throws no checked exception needs no handling: the compiler
 * infers {@code E} as {@link RuntimeException}.
 */
public interface Transactions {
    @FunctionalInterface
    interface Work<T, E extends Exception> {
        T run() throws E;
    }

    /**
     * Runs {@code work} inside a transaction, joining the one already open if there is any. Any exception, checked or
     * not, rolls it back and reaches the caller unchanged.
     */
    <T, E extends Exception> T required(Work<T, E> work) throws E;
}
