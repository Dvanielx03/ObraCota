package com.obracota.infrastructure.security.config;

import com.obracota.domain.security.model.Actor;
import com.obracota.domain.security.model.Credential;
import java.util.UUID;
import org.springframework.core.MethodParameter;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * Resolves the {@link Actor} argument of the controllers from the authenticated request, so no controller builds one by
 * hand (§4.6). The actor comes from the {@link Credential} that {@link JwtAuthenticationFilter} leaves in the details, and
 * it has to agree with the authorities the chain authorised: a person needs {@code SESSION_PERSON}, an agent
 * {@code SESSION_AGENT} and its project. Anything else fails closed.
 */
public class ActorArgumentResolver implements HandlerMethodArgumentResolver {
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return Actor.class.equals(parameter.getParameterType());
    }

    @Override
    public Actor resolveArgument(MethodParameter parameter, ModelAndViewContainer mav, NativeWebRequest request,
                                 WebDataBinderFactory binders) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof UUID user)
                || !(authentication.getDetails() instanceof Credential credential) || !credential.userId().equals(user))
            throw new AuthenticationCredentialsNotFoundException("No authenticated user");
        var granted = authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList();
        var agrees = switch (credential.kind()) {
            case ACCESS -> granted.contains(Authorities.PERSON_SESSION) && !granted.contains(Authorities.AGENT_SESSION);
            case AGENT -> granted.contains(Authorities.AGENT_SESSION) && !granted.contains(Authorities.PERSON_SESSION)
                && granted.contains(Authorities.agentProject(credential.project()));
        };
        if (!agrees) throw new AuthenticationCredentialsNotFoundException("The credential does not match its authorities");
        return credential.actor();
    }
}
