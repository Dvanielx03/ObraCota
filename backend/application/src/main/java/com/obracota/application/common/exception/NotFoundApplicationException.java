package com.obracota.application.common.exception;

/** 404. Without a message the REST layer keeps saying «Proyecto no encontrado.», as before. */
public class NotFoundApplicationException extends RuntimeException {
    public NotFoundApplicationException() {}

    public NotFoundApplicationException(String message) { super(message); }
}
