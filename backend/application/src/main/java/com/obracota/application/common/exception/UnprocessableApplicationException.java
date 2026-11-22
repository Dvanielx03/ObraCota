package com.obracota.application.common.exception;

/** 422 with a {@code code}: {@code OPERATION_NOT_ENABLED}, {@code MODEL_TOO_LARGE}, the engine's code… */
public class UnprocessableApplicationException extends RuntimeException {
    private final String code;

    public UnprocessableApplicationException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() { return code; }
}
