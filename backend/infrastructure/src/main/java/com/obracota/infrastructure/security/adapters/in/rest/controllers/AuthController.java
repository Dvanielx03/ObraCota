package com.obracota.infrastructure.security.adapters.in.rest.controllers;

import com.obracota.application.security.dto.SessionResponse;
import com.obracota.application.security.usecase.*;
import com.obracota.infrastructure.security.adapters.in.rest.dtos.CredentialsRequest;
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
    private final boolean secure;
    public AuthController(RegisterUseCase register, LoginUseCase login, RefreshUseCase refresh, LogoutUseCase logout,
                          @Value("${security.secure-cookie}") boolean secure) {
        this.register=register; this.login=login; this.refresh=refresh; this.logout=logout; this.secure=secure;
    }
    public record AuthResponse(String accessToken, String email) {}
    @PostMapping("/register") public ResponseEntity<AuthResponse> register(@Valid @RequestBody CredentialsRequest req) {
        return respond(register.execute(req.email(),req.password()),HttpStatus.CREATED);
    }
    @PostMapping("/login") public ResponseEntity<AuthResponse> login(@Valid @RequestBody CredentialsRequest req) {
        return respond(login.execute(req.email(),req.password()),HttpStatus.OK);
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
    private ResponseEntity<AuthResponse> respond(SessionResponse response, HttpStatus status) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
            .header(HttpHeaders.SET_COOKIE,cookie(response.refreshToken(),Duration.between(Instant.now(),response.expiresAt())))
            .body(new AuthResponse(response.accessToken(),response.email()));
    }
}
