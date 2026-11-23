package com.obracota.infrastructure.common.exception;

import com.obracota.application.common.exception.*;
import com.obracota.domain.modelchange.model.ChangeStateException;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.MethodArgumentNotValidException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(NotFoundApplicationException.class) @ResponseStatus(HttpStatus.NOT_FOUND)
    ErrorResponse missing(NotFoundApplicationException error) {
        return new ErrorResponse(Objects.requireNonNullElse(error.getMessage(), "Proyecto no encontrado."));
    }
    @ExceptionHandler({IllegalArgumentException.class, MethodArgumentNotValidException.class}) @ResponseStatus(HttpStatus.BAD_REQUEST)
    ErrorResponse invalid() { return new ErrorResponse("Revisa los campos indicados."); }
    @ExceptionHandler(InvalidRequestApplicationException.class) @ResponseStatus(HttpStatus.BAD_REQUEST)
    ErrorResponse invalid(InvalidRequestApplicationException error) { return new ErrorResponse(error.getMessage(), error.code()); }
    @ExceptionHandler(ForbiddenApplicationException.class) @ResponseStatus(HttpStatus.FORBIDDEN)
    ErrorResponse forbidden(ForbiddenApplicationException error) { return new ErrorResponse(error.getMessage()); }
    @ExceptionHandler({ConflictApplicationException.class, ChangeStateException.class}) @ResponseStatus(HttpStatus.CONFLICT)
    ErrorResponse state(RuntimeException error) { return new ErrorResponse(error.getMessage()); }
    @ExceptionHandler(UnprocessableApplicationException.class) @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    ErrorResponse unprocessable(UnprocessableApplicationException error) { return new ErrorResponse(error.getMessage(), error.code()); }
    @ExceptionHandler(EngineContractException.class) @ResponseStatus(HttpStatus.BAD_GATEWAY)
    ErrorResponse contract(EngineContractException error) {
        log.warn("IFC engine answered outside its contract: {}", error.getMessage(), error.getCause());
        return new ErrorResponse(EngineContractException.USER_MESSAGE);
    }
    @ExceptionHandler(EngineUnavailableException.class) @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    ErrorResponse unavailable(EngineUnavailableException error, HttpServletResponse response) {
        if ("ENGINE_BUSY".equals(error.code())) response.setHeader(HttpHeaders.RETRY_AFTER, "5");
        return new ErrorResponse(error.getMessage(), error.code());
    }
    @ExceptionHandler(DataIntegrityViolationException.class) @ResponseStatus(HttpStatus.CONFLICT)
    ErrorResponse conflict() { return new ErrorResponse("El registro entra en conflicto con uno existente."); }
}
