package com.obracota.infrastructure.security.ratelimit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

/**
 * Sliding-window counter of attempts per key, in memory: at most {@code max} attempts inside any {@code window}. It is
 * generic on purpose, so any entry that needs a brute-force guard (login, registration, a future tool endpoint) keys it
 * by what it protects. The state is lost on restart, which only resets the windows.
 */
public final class AttemptLimiter {
    /** Above this many keys, a call sweeps the ones whose window is already empty. */
    private static final int SWEEP_ABOVE = 10_000;

    private final int max;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Deque<Instant>> attempts = new HashMap<>();

    public AttemptLimiter(int max, Duration window, Clock clock) {
        if (max < 1) throw new IllegalArgumentException("max must be at least 1");
        if (window.isNegative() || window.isZero()) throw new IllegalArgumentException("window must be positive");
        this.max = max;
        this.window = window;
        this.clock = clock;
    }

    /** Counts one attempt for {@code key} when there is room; false, and nothing counted, when there is not. */
    public synchronized boolean tryAcquire(String key) {
        var now = clock.instant();
        var times = prune(key, now);
        if (times.size() >= max) return false;
        times.addLast(now);
        return true;
    }

    /** True when {@code key} has used every attempt of the current window. Counts nothing. */
    public synchronized boolean exhausted(String key) {
        return prune(key, clock.instant()).size() >= max;
    }

    /** Counts one attempt for {@code key}, even above the limit (a failure that already happened). */
    public synchronized void record(String key) {
        var now = clock.instant();
        prune(key, now).addLast(now);
    }

    /** Forgets every attempt of {@code key}, for example after a successful login. */
    public synchronized void clear(String key) {
        attempts.remove(key);
    }

    /** How long until {@code key} has room again; zero when it already has. */
    public synchronized Duration retryAfter(String key) {
        var now = clock.instant();
        var times = prune(key, now);
        if (times.size() < max) return Duration.ZERO;
        // The attempt that has to expire is the one that leaves max - 1 behind it.
        var blocking = times.stream().skip(times.size() - max).findFirst().orElse(now);
        var wait = Duration.between(now, blocking.plus(window));
        return wait.isNegative() ? Duration.ZERO : wait;
    }

    private Deque<Instant> prune(String key, Instant now) {
        if (attempts.size() > SWEEP_ABOVE) sweep(now);
        var times = attempts.computeIfAbsent(key, k -> new ArrayDeque<>());
        var oldest = now.minus(window);
        while (!times.isEmpty() && !times.peekFirst().isAfter(oldest)) times.removeFirst();
        return times;
    }

    private void sweep(Instant now) {
        var oldest = now.minus(window);
        attempts.values().removeIf(times -> times.isEmpty() || !times.peekLast().isAfter(oldest));
    }
}
