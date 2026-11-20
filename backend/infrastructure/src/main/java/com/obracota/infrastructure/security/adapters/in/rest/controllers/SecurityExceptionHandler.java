package com.obracota.infrastructure.security.adapters.in.rest.controllers;

import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.infrastructure.common.exception.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class SecurityExceptionHandler {
    @ExceptionHandler(InvalidCredentialsException.class) @ResponseStatus(HttpStatus.UNAUTHORIZED)
    ErrorResponse unauthorized() { return new ErrorResponse("Credenciales o sesión no válidas."); }
}
