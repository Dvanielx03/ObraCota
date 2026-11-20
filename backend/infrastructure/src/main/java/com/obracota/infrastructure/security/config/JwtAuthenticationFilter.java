package com.obracota.infrastructure.security.config;

import com.obracota.domain.security.port.service.TokenService;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.application.security.exception.InvalidCredentialsException;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final TokenService tokens;
    private final SecurityRepository sessions;
    public JwtAuthenticationFilter(TokenService tokens, SecurityRepository sessions) {
        this.tokens=tokens; this.sessions=sessions;
    }
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header=request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            try {
                var t=tokens.readAccess(header.substring(7));
                if (sessions.active(t.sessionId(),t.userId())) {
                    SecurityContextHolder.getContext().setAuthentication(
                        UsernamePasswordAuthenticationToken.authenticated(t.userId(), null, List.of()));
                }
            } catch (InvalidCredentialsException invalid) { SecurityContextHolder.clearContext(); }
        }
        chain.doFilter(request,response);
    }
}
