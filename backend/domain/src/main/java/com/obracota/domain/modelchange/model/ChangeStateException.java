package com.obracota.domain.modelchange.model;

/** A transition that the current state of the change does not allow. The REST layer turns it into a 409. */
public class ChangeStateException extends RuntimeException {
    public ChangeStateException(String message) { super(message); }
}
