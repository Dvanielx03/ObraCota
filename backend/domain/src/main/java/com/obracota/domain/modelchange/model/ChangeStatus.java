package com.obracota.domain.modelchange.model;

/** Life cycle of a model change: {@code DRAFT → READY → APPLIED → RESTORED}, plus {@code DISCARDED}. */
public enum ChangeStatus {
    DRAFT, READY, APPLIED, RESTORED, DISCARDED;

    /** Still a proposal: it can be previewed or discarded. */
    public boolean pending() { return this == DRAFT || this == READY; }

    /** Already published as a revision. */
    public boolean published() { return this == APPLIED || this == RESTORED; }
}
