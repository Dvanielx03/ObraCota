package com.obracota.domain.security.model;

import java.util.Objects;
import java.util.UUID;

/**
 * Who calls a use case. It is never persisted: it travels with every call.
 * <ul>
 *   <li>{@code PERSON}: the owner's browser session. It reaches every project she owns (ownership is proved apart).</li>
 *   <li>{@code AGENT}: acts for that same user, but only inside the project and the run of its credential. It can create
 *       and work on its own drafts, never publish, restore or set prices.</li>
 * </ul>
 */
public record Actor(Kind kind, UUID user, UUID run, UUID project) {
    public enum Kind { PERSON, AGENT }

    public Actor {
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(user, "user");
        if (kind == Kind.PERSON && (run != null || project != null))
            throw new IllegalArgumentException("A person carries neither run nor project");
        if (kind == Kind.AGENT && (run == null || project == null))
            throw new IllegalArgumentException("An agent needs its run and its project");
    }

    public static Actor person(UUID user) { return new Actor(Kind.PERSON, user, null, null); }

    public static Actor agent(UUID user, UUID project, UUID run) { return new Actor(Kind.AGENT, user, run, project); }

    public boolean person() { return kind == Kind.PERSON; }

    public boolean agent() { return kind == Kind.AGENT; }

    /** A person reaches all of her projects; an agent only the project of its credential. */
    public boolean reaches(UUID target) { return person() || project.equals(target); }
}
