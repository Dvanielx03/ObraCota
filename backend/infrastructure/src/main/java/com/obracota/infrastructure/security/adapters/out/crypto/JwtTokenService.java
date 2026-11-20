package com.obracota.infrastructure.security.adapters.out.crypto;

import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.domain.security.model.RefreshToken;
import com.obracota.domain.security.port.service.TokenService;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import javax.crypto.SecretKey;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

public class JwtTokenService implements TokenService {
    private final SecretKey key;
    private final Duration accessTtl, refreshTtl;
    public JwtTokenService(String secret, Duration accessTtl, Duration refreshTtl) {
        this.key=Keys.hmacShaKeyFor(Base64.getDecoder().decode(secret));
        this.accessTtl=accessTtl; this.refreshTtl=refreshTtl;
    }
    public Instant refreshExpiry() { return Instant.now().plus(refreshTtl).truncatedTo(ChronoUnit.SECONDS); }
    public String access(RefreshToken t) { return sign(t, "access", Instant.now().plus(accessTtl)); }
    public String refresh(RefreshToken t) { return sign(t, "refresh", t.expiresAt()); }
    private String sign(RefreshToken t, String kind, Instant expiry) {
        return Jwts.builder().issuer("obracota").subject(t.userId().toString()).id(t.tokenId().toString())
            .claim("kind",kind).claim("sid",t.sessionId().toString()).expiration(Date.from(expiry))
            .signWith(key).compact();
    }
    public RefreshToken readRefresh(String jwt) { return read(jwt, "refresh"); }
    public RefreshToken readAccess(String jwt) { return read(jwt, "access"); }
    private RefreshToken read(String jwt, String kind) {
        try {
            var claims=Jwts.parser().verifyWith(key).requireIssuer("obracota").require("kind",kind).build()
                .parseSignedClaims(jwt).getPayload();
            return new RefreshToken(UUID.fromString(claims.get("sid",String.class)), UUID.fromString(claims.getSubject()),
                UUID.fromString(claims.getId()), claims.getExpiration().toInstant());
        } catch (JwtException | IllegalArgumentException invalid) { throw new InvalidCredentialsException(); }
    }
}
