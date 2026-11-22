package com.obracota.application.common.exception;

/** 400 with a {@code code}: {@code RECIPE_INVALID}, {@code DUPLICATE_TARGET}, {@code SELECTOR_INVALID}… */
public class InvalidRequestApplicationException extends RuntimeException {
    private final String code;

    public InvalidRequestApplicationException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() { return code; }
}
