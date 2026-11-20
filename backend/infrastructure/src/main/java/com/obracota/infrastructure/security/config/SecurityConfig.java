package com.obracota.infrastructure.security.config;

import com.obracota.application.security.usecase.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import com.obracota.domain.security.port.service.*;
import com.obracota.infrastructure.security.adapters.out.crypto.*;
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
    @Bean SecurityFilterChain filter(HttpSecurity http, TokenService t, SecurityRepository r) throws Exception {
        return http.csrf(c -> c.disable()).sessionManagement(c -> c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(c -> c.requestMatchers(HttpMethod.GET,"/actuator/health").permitAll()
                .requestMatchers(HttpMethod.POST,"/api/auth/register","/api/auth/login","/api/auth/refresh","/api/auth/logout").permitAll()
                .requestMatchers("/api/projects","/api/projects/**").authenticated().anyRequest().denyAll())
            .exceptionHandling(c -> c.authenticationEntryPoint((req,res,ex) -> res.setStatus(401)))
            .addFilterBefore(new JwtAuthenticationFilter(t,r), UsernamePasswordAuthenticationFilter.class).build();
    }
}
