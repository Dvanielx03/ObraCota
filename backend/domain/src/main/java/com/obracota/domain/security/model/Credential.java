package com.obracota.domain.security.model;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A verified bearer token. {@code ACCESS} is the person's session; {@code AGENT} binds an agent to one of her sessions,
 * one project and one run, for {@link #AGENT_MAX_TTL} at most. Closing the session kills its agent credentials too,
 * because the filter keeps checking that the session is active.
 */
public record Credential(Kind kind, UUID sessionId, UUID userId, UUID tokenId, UUID project, UUID run, Instant expiresAt) {
    public enum Kind { ACCESS, AGENT }

    public static final Duration AGENT_MAX_TTL = Duration.ofMinutes(15);

    public Credential {
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(sessionId, "sessionId");
        Objects.requireNonNull(userId, "userId");
        if (kind == Kind.AGENT && (project == null || run == null))
            throw new IllegalArgumentException("An agent credential needs its project and its run");
        if (kind == Kind.ACCESS && (project != null || run != null))
            throw new IllegalArgumentException("An access credential carries neither project nor run");
    }

    /** The actor the use cases receive for this credential. */
    public Actor actor() {
        return kind == Kind.ACCESS ? Actor.person(userId) : Actor.agent(userId, project, run);
    }
}
