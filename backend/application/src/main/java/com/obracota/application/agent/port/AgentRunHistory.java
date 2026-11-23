package com.obracota.application.agent.port;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AgentRunHistory {
    enum Status { RUNNING, READY, NO_CHANGE, DISCARDED, STOPPED_LIMIT, FAILED, INTERRUPTED, LEGACY }

    record Run(UUID id, UUID project, UUID version, UUID user, String provider, String model, Status status,
               String message, UUID change, Instant startedAt, Instant finishedAt) {}

    void start(UUID id, UUID project, UUID version, UUID user, String provider, String model);

    void finish(UUID id, Status status, String message, UUID change);

    List<Run> list(UUID project, UUID user, UUID version, UUID change);
}
