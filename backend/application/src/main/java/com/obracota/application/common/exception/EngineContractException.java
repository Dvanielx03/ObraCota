package com.obracota.application.common.exception;

/**
 * 502: the engine answered something outside its contract (a body that is not JSON, a 500, missing {@code /build}
 * headers, unreadable JSON). It is never treated as «unavailable». The message is for the logs; the person reads
 * {@link #USER_MESSAGE}.
 */
public class EngineContractException extends RuntimeException {
    public static final String USER_MESSAGE = "Respuesta no válida del motor IFC.";

    public EngineContractException(String detail) { super(detail); }

    public EngineContractException(String detail, Throwable cause) { super(detail, cause); }
}
