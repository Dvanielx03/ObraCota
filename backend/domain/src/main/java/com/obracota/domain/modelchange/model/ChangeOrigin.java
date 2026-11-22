package com.obracota.domain.modelchange.model;

import com.obracota.domain.security.model.Actor;

/** Who proposed a change: the person or the agent (whatever the agent creates is always labelled as such). */
public enum ChangeOrigin {
    PERSON, AGENT;

    public static ChangeOrigin of(Actor actor) { return actor.person() ? PERSON : AGENT; }
}
