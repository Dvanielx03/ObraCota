package com.obracota.infrastructure.security.adapters.in.rest.controllers;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.application.security.usecase.*;
import com.obracota.infrastructure.security.adapters.in.rest.dtos.CredentialsRequest;
import com.obracota.infrastructure.security.adapters.in.rest.dtos.GoogleCredentialRequest;
import com.obracota.infrastructure.security.ratelimit.AuthAttempts;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.Duration;
import java.time.Instant;

@RestController
@RequestMapping(value="/api/auth",headers="X-ObraCota-Client=web")
@Transactional
public class AuthController {
    private final RegisterUseCase register;
    private final LoginUseCase login;
    private final RefreshUseCase refresh;
    private final LogoutUseCase logout;
    private final GoogleSignInUseCase google;
    private final AuthAttempts attempts;
    private final boolean secure;
    private final String googleClientId;
    public AuthController(RegisterUseCase register, LoginUseCase login, RefreshUseCase refresh, LogoutUseCase logout,
                          GoogleSignInUseCase google, AuthAttempts attempts, @Value("${security.secure-cookie}") boolean secure,
                          @Value("${security.google.client-id:}") String googleClientId) {
        this.register=register; this.login=login; this.refresh=refresh; this.logout=logout; this.google=google;
        this.attempts=attempts; this.secure=secure; this.googleClientId=googleClientId.strip();
    }
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public record AuthResponse(String accessToken, String email, Boolean created) {}
    /** The public OAuth client id the sign-in pages give Google Identity Services; empty when Google is off. */
    public record GoogleConfig(String clientId) {}
    @GetMapping("/google/config") public ResponseEntity<GoogleConfig> googleConfig() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new GoogleConfig(googleClientId));
    }
    /** Signs in, or creates the account, with a Google ID token; the session is the one login issues. */
    @PostMapping("/google") public ResponseEntity<AuthResponse> google(@Valid @RequestBody GoogleCredentialRequest req, HttpServletRequest http) {
        attempts.register(http.getRemoteAddr());
        var outcome = google.signIn(req.credential());
        return respond(outcome.session(),outcome.created()?HttpStatus.CREATED:HttpStatus.OK,outcome.created());
    }
    @PostMapping("/register") public ResponseEntity<AuthResponse> register(@Valid @RequestBody CredentialsRequest req, HttpServletRequest http) {
        attempts.register(http.getRemoteAddr());
        return respond(register.execute(req.email(),req.password()),HttpStatus.CREATED);
    }
    @PostMapping("/login") public ResponseEntity<AuthResponse> login(@Valid @RequestBody CredentialsRequest req, HttpServletRequest http) {
        attempts.login(http.getRemoteAddr(),req.email());
        try {
            var session=login.execute(req.email(),req.password());
            attempts.succeeded(req.email());
            return respond(session,HttpStatus.OK);
        } catch(InvalidCredentialsException e) {
            attempts.failed(req.email());
            throw e;
        }
    }
    @PostMapping("/refresh") public ResponseEntity<AuthResponse> refresh(@CookieValue(name="oc_refresh",defaultValue="") String jwt) {
        return respond(refresh.execute(jwt),HttpStatus.OK);
    }
    @PostMapping("/logout") public ResponseEntity<Void> logout(@CookieValue(name="oc_refresh",defaultValue="") String jwt) {
        logout.execute(jwt);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE,cookie("",Duration.ZERO)).build();
    }
    private String cookie(String value, Duration age) {
        return ResponseCookie.from("oc_refresh",value).httpOnly(true).secure(secure).sameSite("Strict")
            .path("/api/auth").maxAge(age).build().toString();
    }
    private ResponseEntity<AuthResponse> respond(SessionResponse response, HttpStatus status) { return respond(response,status,null); }
    private ResponseEntity<AuthResponse> respond(SessionResponse response, HttpStatus status, Boolean created) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
            .header(HttpHeaders.SET_COOKIE,cookie(response.refreshToken(),Duration.between(Instant.now(),response.expiresAt())))
            .body(new AuthResponse(response.accessToken(),response.email(),created));
    }
}
