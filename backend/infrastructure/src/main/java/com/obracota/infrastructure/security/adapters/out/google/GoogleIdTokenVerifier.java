package com.obracota.infrastructure.security.adapters.out.google;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.domain.security.model.GoogleIdentity;
import com.obracota.domain.security.port.service.GoogleIdentityVerifier;
import io.jsonwebtoken.*;
import java.io.IOException;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.Key;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Verifies Google ID tokens locally, without any paid service: the RS256 signature against Google's public keys (JWKS,
 * cached by {@code kid} for the {@code max-age} Google sends), the issuer, the audience (our OAuth client id), the expiry
 * and {@code email_verified}.
 */
public class GoogleIdTokenVerifier implements GoogleIdentityVerifier {
    public static final URI GOOGLE_CERTS = URI.create("https://www.googleapis.com/oauth2/v3/certs");
    static final Set<String> ISSUERS = Set.of("accounts.google.com", "https://accounts.google.com");
    private static final Duration DEFAULT_MAX_AGE = Duration.ofHours(1);
    /** A token with an unknown {@code kid} may trigger a new download at most this often (Google rotates keys). */
    private static final Duration MIN_REFETCH = Duration.ofMinutes(1);
    private static final Logger log = LoggerFactory.getLogger(GoogleIdTokenVerifier.class);

    /** Where the JWKS comes from: Google over HTTPS in production, a stub in the tests. */
    public interface KeySource {
        Fetched fetch() throws IOException, InterruptedException;
        record Fetched(String json, Duration maxAge) {}
    }

    private record Keys(Map<String, PublicKey> byKid, Instant expires, Instant fetched) {}

    private final String clientId;
    private final KeySource source;
    private final Clock clock;
    private final ObjectMapper json = new ObjectMapper();
    private volatile Keys keys = new Keys(Map.of(), Instant.MIN, Instant.MIN);

    public GoogleIdTokenVerifier(String clientId, KeySource source, Clock clock) {
        this.clientId = clientId == null ? "" : clientId.strip();
        this.source = source;
        this.clock = clock;
    }

    public boolean enabled() { return !clientId.isEmpty(); }

    public Optional<GoogleIdentity> verify(String credential) {
        if (!enabled() || credential == null || credential.isBlank() || credential.length() > 8192) return Optional.empty();
        try {
            Claims claims = Jwts.parser().keyLocator(this::locate).clock(() -> Date.from(clock.instant())).clockSkewSeconds(30)
                .build().parseSignedClaims(credential).getPayload();
            if (!ISSUERS.contains(claims.getIssuer())) return Optional.empty();
            Set<String> audience = claims.getAudience();
            if (audience == null || audience.size() != 1 || !audience.contains(clientId)) return Optional.empty();
            if (claims.getExpiration() == null) return Optional.empty();
            Object verified = claims.get("email_verified");
            if (!(Boolean.TRUE.equals(verified) || "true".equals(verified))) return Optional.empty();
            String subject = claims.getSubject();
            String email = claims.get("email", String.class);
            if (subject == null || subject.isBlank() || email == null || email.length() > 254 || !email.contains("@"))
                return Optional.empty();
            return Optional.of(new GoogleIdentity(subject, email));
        } catch (JwtException | IllegalArgumentException | ClassCastException invalid) {
            return Optional.empty();
        }
    }

    private Key locate(Header header) {
        if (!(header instanceof JwsHeader jws) || !"RS256".equals(jws.getAlgorithm()) || jws.getKeyId() == null)
            throw new UnsupportedJwtException("Google signs its ID tokens with RS256 and a kid");
        PublicKey key = key(jws.getKeyId());
        if (key == null) throw new UnsupportedJwtException("Unknown Google key");
        return key;
    }

    private PublicKey key(String kid) {
        Instant now = clock.instant();
        Keys current = keys;
        if (current.expires().isAfter(now) && current.byKid().containsKey(kid)) return current.byKid().get(kid);
        synchronized (this) {
            current = keys;
            boolean stale = !current.expires().isAfter(now) || !current.byKid().containsKey(kid);
            if (stale && !current.fetched().plus(MIN_REFETCH).isAfter(now)) {
                try { keys = current = download(now); }
                catch (IOException | InterruptedException | RuntimeException failed) {
                    if (failed instanceof InterruptedException) Thread.currentThread().interrupt();
                    log.warn("Google public keys could not be downloaded: {}", failed.toString());
                    // Keep the previous keys; a retry waits MIN_REFETCH.
                    keys = current = new Keys(current.byKid(), current.expires(), now);
                }
            }
            return current.byKid().get(kid);
        }
    }

    private Keys download(Instant now) throws IOException, InterruptedException {
        var fetched = source.fetch();
        Map<String, PublicKey> byKid = new HashMap<>();
        var factory = rsa();
        for (JsonNode jwk : json.readTree(fetched.json()).path("keys")) {
            if (!"RSA".equals(jwk.path("kty").asText()) || !jwk.hasNonNull("kid")) continue;
            var decoder = Base64.getUrlDecoder();
            var spec = new RSAPublicKeySpec(new BigInteger(1, decoder.decode(jwk.path("n").asText())),
                new BigInteger(1, decoder.decode(jwk.path("e").asText())));
            try { byKid.put(jwk.get("kid").asText(), factory.generatePublic(spec)); }
            catch (java.security.spec.InvalidKeySpecException skip) { /* A key we cannot read cannot sign for us. */ }
        }
        Duration age = fetched.maxAge() == null || fetched.maxAge().isNegative() ? DEFAULT_MAX_AGE : fetched.maxAge();
        return new Keys(Map.copyOf(byKid), now.plus(age), now);
    }

    private static KeyFactory rsa() {
        try { return KeyFactory.getInstance("RSA"); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static final Pattern MAX_AGE = Pattern.compile("max-age=(\\d+)");

    /** Downloads Google's JWKS and honours its {@code Cache-Control: max-age}. */
    public static KeySource http(URI uri) {
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NORMAL).build();
        return () -> {
            var response = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(8)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IOException("Google JWKS answered " + response.statusCode());
            Duration age = response.headers().firstValue("Cache-Control").map(MAX_AGE::matcher)
                .filter(java.util.regex.Matcher::find).map(m -> Duration.ofSeconds(Long.parseLong(m.group(1)))).orElse(null);
            return new KeySource.Fetched(response.body(), age);
        };
    }
}
