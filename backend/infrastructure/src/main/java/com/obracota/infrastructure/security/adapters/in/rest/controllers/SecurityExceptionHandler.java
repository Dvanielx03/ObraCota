package com.obracota.infrastructure.security.adapters.in.rest.controllers;

import com.obracota.application.security.exception.GoogleSignInUnavailableException;
import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.infrastructure.common.exception.ErrorResponse;
import com.obracota.infrastructure.security.ratelimit.AuthAttempts;
import com.obracota.infrastructure.security.ratelimit.TooManyAttemptsException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class SecurityExceptionHandler {
    @ExceptionHandler(InvalidCredentialsException.class) @ResponseStatus(HttpStatus.UNAUTHORIZED)
    ErrorResponse unauthorized() { return new ErrorResponse("Credenciales o sesión no válidas."); }
    @ExceptionHandler(GoogleSignInUnavailableException.class) @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    ErrorResponse googleOff() { return new ErrorResponse("El acceso con Google no está disponible en este servidor.","GOOGLE_SIGN_IN_OFF"); }
    @ExceptionHandler(TooManyAttemptsException.class)
    ResponseEntity<ErrorResponse> tooMany(TooManyAttemptsException error) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .header(HttpHeaders.RETRY_AFTER,Long.toString(AuthAttempts.seconds(error.retryAfter())))
            .body(new ErrorResponse("Demasiados intentos. Espera unos minutos y vuelve a intentarlo.","TOO_MANY_ATTEMPTS"));
    }
}
