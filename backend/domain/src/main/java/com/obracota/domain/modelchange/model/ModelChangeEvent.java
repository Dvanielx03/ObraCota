package com.obracota.domain.modelchange.model;

import com.obracota.domain.security.model.Actor;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Audit trail of a change: one row per transition, with the kind of actor, the user and the run.
 * Actions of the system itself (the sweeper, a base that stopped being the latest) use {@code SYSTEM}.
 */
public record ModelChangeEvent(UUID change, Action action, ActorKind actorKind, UUID actorUser, UUID agentRun, String detail, Instant at) {
    public enum Action { CREATE, EDIT, PREVIEW, SUBMIT, DISCARD, APPLY, RESTORE, PREVIEW_CLEARED }
    public enum ActorKind { PERSON, AGENT, SYSTEM }

    public static final int DETAIL_LIMIT = 2000;

    public ModelChangeEvent {
        Objects.requireNonNull(change, "change");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(actorKind, "actorKind");
        Objects.requireNonNull(at, "at");
        if (actorKind == ActorKind.SYSTEM && (actorUser != null || agentRun != null))
            throw new IllegalArgumentException("A system event has no user");
        if ((actorKind == ActorKind.AGENT) != (agentRun != null))
            throw new IllegalArgumentException("Only an agent event carries a run");
        if (detail != null && detail.length() > DETAIL_LIMIT) detail = detail.substring(0, DETAIL_LIMIT);
    }

    public static ModelChangeEvent of(UUID change, Action action, Actor actor, String detail, Instant at) {
        return new ModelChangeEvent(change, action, actor.person() ? ActorKind.PERSON : ActorKind.AGENT,
            actor.user(), actor.run(), detail, at);
    }

    public static ModelChangeEvent system(UUID change, Action action, String detail, Instant at) {
        return new ModelChangeEvent(change, action, ActorKind.SYSTEM, null, null, detail, at);
    }
}
