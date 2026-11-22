package com.obracota.infrastructure.security.ratelimit;

import java.time.Duration;
import java.util.Locale;

/**
 * Brute-force guard of {@code /api/auth/login} and {@code /api/auth/register}, on two {@link AttemptLimiter}s:
 * <ul>
 *   <li>every login or registration from one client address, failed or not (floods and account farming);</li>
 *   <li>failed logins of one account from any address (password guessing); a successful login clears them.</li>
 * </ul>
 * The address is the socket's: no forwarding header is trusted, because the backend is only published on 127.0.0.1
 * and reached through the app server.
 */
public final class AuthAttempts {
    private final AttemptLimiter addresses;
    private final AttemptLimiter accounts;

    public AuthAttempts(AttemptLimiter addresses, AttemptLimiter accounts) {
        this.addresses = addresses;
        this.accounts = accounts;
    }

    /** Admits a registration from {@code address}, or throws. */
    public void register(String address) {
        admit(addresses, "address:" + address);
    }

    /** Admits a login of {@code email} from {@code address}, or throws. A blocked account does not spend the address. */
    public void login(String address, String email) {
        var account = account(email);
        if (accounts.exhausted(account)) throw new TooManyAttemptsException(accounts.retryAfter(account));
        admit(addresses, "address:" + address);
    }

    public void failed(String email) { accounts.record(account(email)); }

    public void succeeded(String email) { accounts.clear(account(email)); }

    private static void admit(AttemptLimiter limiter, String key) {
        if (!limiter.tryAcquire(key)) throw new TooManyAttemptsException(limiter.retryAfter(key));
    }

    private static String account(String email) {
        return "account:" + (email == null ? "" : email.strip().toLowerCase(Locale.ROOT));
    }

    /** Seconds for {@code Retry-After}, rounded up and at least one. */
    public static long seconds(Duration wait) {
        return Math.max(1, (wait.toMillis() + 999) / 1000);
    }
}
