package com.obracota.application.agent.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Diary of the agent's tool calls ({@code agent_tool_call}, V15): one row per call, accepted, rejected or failed. */
public interface AgentToolJournal {
    enum Status { OK, REJECTED, ERROR }

    record Entry(UUID run, int step, int seq, UUID project, UUID user, UUID change, String tool, Map<String, Object> arguments,
                 Map<String, Object> result, Status status, String errorCode, int durationMs) {}

    void record(Entry entry);

    /** The calls of one run of {@code user} in {@code project}, in order. */
    List<Entry> list(UUID project, UUID user, UUID run);
}
