package com.obracota.application.common.exception;

/** 503: the engine cannot answer now (down, {@code ENGINE_BUSY}, deadline, preview lost). The change keeps its state. */
public class EngineUnavailableException extends RuntimeException {
    private final String code;

    public EngineUnavailableException(String code, String message) {
        super(message);
        this.code = code;
    }

    public EngineUnavailableException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    /** {@code ENGINE_BUSY}, {@code DEADLINE_EXCEEDED}… or {@code null}. */
    public String code() { return code; }
}
