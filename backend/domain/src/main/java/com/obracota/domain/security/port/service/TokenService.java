package com.obracota.domain.security.port.service;

import com.obracota.domain.security.model.Credential;
import com.obracota.domain.security.model.RefreshToken;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

public interface TokenService {
    Instant refreshExpiry();
    String access(RefreshToken session);
    String refresh(RefreshToken session);
    RefreshToken readRefresh(String jwt);
    RefreshToken readAccess(String jwt);

    /**
     * An agent credential bound to {@code session}, one project and one run. {@code ttl} is at most
     * {@link Credential#AGENT_MAX_TTL}; a longer one is refused with {@link IllegalArgumentException}.
     */
    String agent(RefreshToken session, UUID project, UUID run, Duration ttl);

    /** The bearer of a request: an access token (the person) or an agent credential. Anything else is invalid. */
    Credential readBearer(String jwt);
}
