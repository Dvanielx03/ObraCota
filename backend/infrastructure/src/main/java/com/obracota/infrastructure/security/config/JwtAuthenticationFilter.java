package com.obracota.infrastructure.security.config;

import com.obracota.domain.security.model.Credential;
import com.obracota.domain.security.port.service.TokenService;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.application.security.exception.InvalidCredentialsException;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Authenticates the bearer: a person's access token or an agent credential (§4.6). Both need their session to be active,
 * so closing it also kills its agent credentials. The principal stays the user's UUID; the {@link Credential} goes in the
 * details, where {@link ActorArgumentResolver} reads it.
 */
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
                var credential=tokens.readBearer(header.substring(7));
                if (sessions.active(credential.sessionId(),credential.userId())) {
                    var authorities=credential.kind() == Credential.Kind.ACCESS
                        ? List.of(new SimpleGrantedAuthority(Authorities.PERSON_SESSION))
                        : List.of(new SimpleGrantedAuthority(Authorities.AGENT_SESSION),
                                  new SimpleGrantedAuthority(Authorities.agentProject(credential.project())));
                    var authentication=UsernamePasswordAuthenticationToken.authenticated(credential.userId(), null, authorities);
                    authentication.setDetails(credential);
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } catch (InvalidCredentialsException invalid) { SecurityContextHolder.clearContext(); }
        }
        chain.doFilter(request,response);
    }
}
