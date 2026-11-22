package com.obracota.infrastructure.security.config;

import com.obracota.application.security.usecase.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.*;
import com.obracota.infrastructure.security.adapters.out.crypto.*;
import com.obracota.infrastructure.security.ratelimit.*;
import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {
    @Bean TokenService tokens(@Value("${security.jwt-secret}") String secret, @Value("${security.access-ttl}") Duration access,
            @Value("${security.refresh-ttl}") Duration refresh) { return new JwtTokenService(secret,access,refresh); }
    @Bean PasswordService passwords() { return new BCryptPasswordService(); }
    @Bean SessionIssuer issuer(SecurityRepository r, TokenService t) { return new SessionIssuer(r,t); }
    @Bean RegisterUseCase register(SecurityRepository r, PasswordService p, SessionIssuer i) { return new RegisterUseCase(r,p,i); }
    @Bean LoginUseCase login(SecurityRepository r, PasswordService p, SessionIssuer i) { return new LoginUseCase(r,p,i); }
    @Bean RefreshUseCase refresh(SecurityRepository r, TokenService t, SessionIssuer i) { return new RefreshUseCase(r,t,i); }
    @Bean LogoutUseCase logout(SecurityRepository r, TokenService t) { return new LogoutUseCase(r,t); }
    /** Login and registration limits; the defaults leave room for a whole Playwright run from one address. */
    @Bean AuthAttempts authAttempts(@Value("${security.attempts.per-address:120}") int perAddress,
            @Value("${security.attempts.address-window:PT1M}") Duration addressWindow,
            @Value("${security.attempts.failed-logins:10}") int failedLogins,
            @Value("${security.attempts.failed-login-window:PT15M}") Duration failedLoginWindow) {
        var clock = Clock.systemUTC();
        return new AuthAttempts(new AttemptLimiter(perAddress,addressWindow,clock),new AttemptLimiter(failedLogins,failedLoginWindow,clock));
    }
    @Bean SecurityFilterChain filter(HttpSecurity http, TokenService t, SecurityRepository r) throws Exception {
        return http.csrf(c -> c.disable()).sessionManagement(c -> c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(c -> c.requestMatchers(HttpMethod.GET,"/actuator/health").permitAll()
                .requestMatchers(HttpMethod.POST,"/api/auth/register","/api/auth/login","/api/auth/refresh","/api/auth/logout").permitAll()
                // The first matching rule wins (§4.6). Publishing, restoring and pricing are the person's:
                .requestMatchers(HttpMethod.POST,
                    "/api/projects/*/model-changes/*/apply","/api/projects/*/model-changes/*/restore",
                    "/api/projects/*/design-changes/*/apply","/api/projects/*/design-changes/*/restore",
                    "/api/projects/*/versions/*/prices/copy").hasAuthority(Authorities.PERSON_SESSION)
                .requestMatchers(HttpMethod.PUT,
                    "/api/projects/*/design-changes/pricing","/api/projects/*/versions/*/prices").hasAuthority(Authorities.PERSON_SESSION)
                // What an agent credential may touch, only inside its own project:
                .requestMatchers("/api/projects/{project}/model-changes","/api/projects/{project}/model-changes/**").access(new AgentScope())
                .requestMatchers(HttpMethod.GET,"/api/projects/{project}/files","/api/projects/{project}/files/*/versions",
                    "/api/projects/{project}/versions/{version}","/api/projects/{project}/versions/{version}/summary",
                    "/api/projects/{project}/versions/{version}/elements","/api/projects/{project}/versions/{version}/elements/*",
                    "/api/projects/{project}/versions/{version}/prices").access(new AgentScope())
                // Everything else under the projects stays with the person:
                .requestMatchers("/api/projects","/api/projects/**").hasAuthority(Authorities.PERSON_SESSION)
                .anyRequest().denyAll())
            .exceptionHandling(c -> c.authenticationEntryPoint((req,res,ex) -> res.setStatus(401)).accessDeniedHandler(new JsonAccessDenied()))
            .addFilterBefore(new JwtAuthenticationFilter(t,r), UsernamePasswordAuthenticationFilter.class).build();
    }
}
