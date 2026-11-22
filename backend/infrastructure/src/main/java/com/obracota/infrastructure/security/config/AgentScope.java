package com.obracota.infrastructure.security.config;

import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationResult;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

/**
 * The routes an agent credential may call, and only inside its own project (§4.6): the person passes, an agent passes when
 * its {@code AGENT_PROJECT_<uuid>} matches the {@code {project}} path variable, anyone else (or a malformed UUID) is denied.
 * In Spring Security 6.5 (Boot 3.5) {@code check} is the abstract method, deprecated, and the default {@code authorize}
 * calls it; both are implemented with the same decision, and moving to 7.x only drops {@code check}.
 */
public final class AgentScope implements AuthorizationManager<RequestAuthorizationContext> {
    @Override
    public AuthorizationResult authorize(Supplier<Authentication> authentication, RequestAuthorizationContext context) {
        return decide(authentication.get(), context);
    }

    @Override
    @Deprecated
    @SuppressWarnings("deprecation")
    public AuthorizationDecision check(Supplier<Authentication> authentication, RequestAuthorizationContext context) {
        return decide(authentication.get(), context);
    }

    private static AuthorizationDecision decide(Authentication authentication, RequestAuthorizationContext context) {
        if (authentication == null || !authentication.isAuthenticated()) return new AuthorizationDecision(false);
        var granted = authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList();
        if (granted.contains(Authorities.PERSON_SESSION)) return new AuthorizationDecision(true);
        if (!granted.contains(Authorities.AGENT_SESSION)) return new AuthorizationDecision(false);
        UUID project;
        try {
            project = UUID.fromString(context.getVariables().get("project"));
        } catch (IllegalArgumentException | NullPointerException invalid) {
            return new AuthorizationDecision(false);
        }
        return new AuthorizationDecision(granted.contains(Authorities.agentProject(project)));
    }
}
