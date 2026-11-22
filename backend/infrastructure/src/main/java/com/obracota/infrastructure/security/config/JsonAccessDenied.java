package com.obracota.infrastructure.security.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;

/**
 * The 403 of the security chain carries the same JSON body as the use cases (§4.1); without it Spring answers an empty 403
 * and the interface would show its generic text.
 */
public final class JsonAccessDenied implements AccessDeniedHandler {
    static final String MESSAGE = "Publicar, restaurar y fijar precios exigen la sesión de la propietaria.";
    private static final byte[] BODY = ("{\"message\":\"" + MESSAGE + "\"}").getBytes(StandardCharsets.UTF_8);

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException denied) throws IOException {
        if (response.isCommitted()) return;
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentLength(BODY.length);
        response.getOutputStream().write(BODY);
    }
}
