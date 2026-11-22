package com.obracota.infrastructure.security.config;

import java.util.UUID;

/**
 * The authorities {@link JwtAuthenticationFilter} grants (§4.6). A person's access token gets {@link #PERSON_SESSION};
 * an agent credential gets {@link #AGENT_SESSION} plus {@link #agentProject} of the only project it reaches.
 */
public final class Authorities {
    public static final String PERSON_SESSION = "SESSION_PERSON";
    public static final String AGENT_SESSION = "SESSION_AGENT";
    static final String AGENT_PROJECT_PREFIX = "AGENT_PROJECT_";

    private Authorities() {}

    public static String agentProject(UUID project) { return AGENT_PROJECT_PREFIX + project; }
}
