package com.obracota.infrastructure.security.ratelimit;

import java.time.Duration;

/** 429: the caller used every attempt of the window. {@link #retryAfter()} goes to the {@code Retry-After} header. */
public class TooManyAttemptsException extends RuntimeException {
    private final Duration retryAfter;

    public TooManyAttemptsException(Duration retryAfter) {
        super("Too many attempts");
        this.retryAfter = retryAfter;
    }

    public Duration retryAfter() { return retryAfter; }
}
