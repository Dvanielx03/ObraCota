package com.obracota.infrastructure.security.adapters.out.crypto;

import com.obracota.application.security.exception.InvalidCredentialsException;
import com.obracota.domain.security.model.Credential;
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

    /** {@code kind=agent}, with its project, its run and {@code iat}, so the reader can bound its life (§4.6). */
    public String agent(RefreshToken t, UUID project, UUID run, Duration ttl) {
        Objects.requireNonNull(project, "project");
        Objects.requireNonNull(run, "run");
        if (ttl == null || ttl.isNegative() || ttl.isZero() || ttl.compareTo(Credential.AGENT_MAX_TTL) > 0)
            throw new IllegalArgumentException("An agent credential lives " + Credential.AGENT_MAX_TTL.toMinutes() + " minutes at most");
        var issued = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        return Jwts.builder().issuer("obracota").subject(t.userId().toString()).id(UUID.randomUUID().toString())
            .claim("kind","agent").claim("sid",t.sessionId().toString()).claim("prj",project.toString()).claim("run",run.toString())
            .issuedAt(Date.from(issued)).expiration(Date.from(issued.plus(ttl))).signWith(key).compact();
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

    /** Like {@link #read}, without fixing {@code kind}: {@code access} is the person, {@code agent} an agent credential. */
    public Credential readBearer(String jwt) {
        try {
            var claims=Jwts.parser().verifyWith(key).requireIssuer("obracota").build().parseSignedClaims(jwt).getPayload();
            var session=UUID.fromString(claims.get("sid",String.class));
            var user=UUID.fromString(claims.getSubject());
            var token=UUID.fromString(claims.getId());
            var expires=claims.getExpiration().toInstant();
            return switch (claims.get("kind",String.class)) {
                case "access" -> new Credential(Credential.Kind.ACCESS, session, user, token, null, null, expires);
                case "agent" -> {
                    var issued=claims.getIssuedAt().toInstant();
                    if (Duration.between(issued, expires).compareTo(Credential.AGENT_MAX_TTL) > 0) throw new InvalidCredentialsException();
                    yield new Credential(Credential.Kind.AGENT, session, user, token, UUID.fromString(claims.get("prj",String.class)),
                        UUID.fromString(claims.get("run",String.class)), expires);
                }
                default -> throw new InvalidCredentialsException();
            };
        } catch (JwtException | IllegalArgumentException | NullPointerException invalid) { throw new InvalidCredentialsException(); }
    }
}
