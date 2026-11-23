package com.obracota.infrastructure.security.google;

import com.obracota.infrastructure.security.adapters.out.google.GoogleIdTokenVerifier;
import io.jsonwebtoken.Jwts;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.Date;
import java.util.concurrent.atomic.AtomicInteger;

/** A local stand-in for Google: an RSA key, its JWKS and ID tokens signed with it. No network. */
final class GoogleTokens {
    static final String CLIENT_ID = "1234-obracota.apps.googleusercontent.com";
    final KeyPair key = generate();
    final String kid;
    final AtomicInteger downloads = new AtomicInteger();

    GoogleTokens(String kid) { this.kid = kid; }

    static KeyPair generate() {
        try { var g = KeyPairGenerator.getInstance("RSA"); g.initialize(2048); return g.generateKeyPair(); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    String jwks() {
        var pub = (RSAPublicKey) key.getPublic();
        var b64 = Base64.getUrlEncoder().withoutPadding();
        return "{\"keys\":[{\"kty\":\"RSA\",\"alg\":\"RS256\",\"use\":\"sig\",\"kid\":\"" + kid + "\",\"n\":\""
            + b64.encodeToString(unsigned(pub.getModulus().toByteArray())) + "\",\"e\":\""
            + b64.encodeToString(unsigned(pub.getPublicExponent().toByteArray())) + "\"}]}";
    }

    private static byte[] unsigned(byte[] bytes) {
        return bytes.length > 1 && bytes[0] == 0 ? Arrays.copyOfRange(bytes, 1, bytes.length) : bytes;
    }

    GoogleIdTokenVerifier.KeySource source() {
        return () -> { downloads.incrementAndGet(); return new GoogleIdTokenVerifier.KeySource.Fetched(jwks(), Duration.ofHours(6)); };
    }

    Token token() { return new Token(); }

    final class Token {
        String issuer = "https://accounts.google.com", audience = CLIENT_ID, subject = "1098765432101234567890";
        String email = "ingeniera@example.test";
        Object emailVerified = true;
        Instant expires = Instant.now().plus(Duration.ofMinutes(30));
        KeyPair signer = key;
        String keyId = kid;
        Token issuer(String v) { issuer = v; return this; }
        Token audience(String v) { audience = v; return this; }
        Token subject(String v) { subject = v; return this; }
        Token email(String v) { email = v; return this; }
        Token emailVerified(Object v) { emailVerified = v; return this; }
        Token expires(Instant v) { expires = v; return this; }
        Token signer(KeyPair v) { signer = v; return this; }
        Token keyId(String v) { keyId = v; return this; }
        String sign() {
            var builder = Jwts.builder().header().keyId(keyId).and().issuer(issuer).audience().single(audience).subject(subject)
                .claim("email", email).issuedAt(Date.from(expires.minus(Duration.ofHours(1)))).expiration(Date.from(expires));
            if (emailVerified != null) builder.claim("email_verified", emailVerified);
            return builder.signWith(signer.getPrivate(), Jwts.SIG.RS256).compact();
        }
    }
}
