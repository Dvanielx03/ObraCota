package com.obracota.application.common.exception;

/** 409: the request is valid but the current state does not allow it (stale base, modified change…). */
public class ConflictApplicationException extends RuntimeException {
    public ConflictApplicationException(String message) { super(message); }
}
