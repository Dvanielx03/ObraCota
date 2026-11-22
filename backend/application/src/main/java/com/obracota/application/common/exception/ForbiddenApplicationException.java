package com.obracota.application.common.exception;

/** 403: the actor is known but may not do this (an agent publishing, or working outside its project or run). */
public class ForbiddenApplicationException extends RuntimeException {
    public ForbiddenApplicationException(String message) { super(message); }
}
