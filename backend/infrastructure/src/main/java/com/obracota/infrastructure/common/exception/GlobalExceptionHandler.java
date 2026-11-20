package com.obracota.infrastructure.common.exception;

import com.obracota.application.common.exception.NotFoundApplicationException;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.MethodArgumentNotValidException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(NotFoundApplicationException.class) @ResponseStatus(HttpStatus.NOT_FOUND)
    ErrorResponse missing() { return new ErrorResponse("Proyecto no encontrado."); }
    @ExceptionHandler({IllegalArgumentException.class, MethodArgumentNotValidException.class}) @ResponseStatus(HttpStatus.BAD_REQUEST)
    ErrorResponse invalid() { return new ErrorResponse("Revisa los campos indicados."); }
    @ExceptionHandler(DataIntegrityViolationException.class) @ResponseStatus(HttpStatus.CONFLICT)
    ErrorResponse conflict() { return new ErrorResponse("El registro entra en conflicto con uno existente."); }
}
