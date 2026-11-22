package com.obracota.application.airun.port;

import com.obracota.domain.airun.Consumption;
import java.util.UUID;

/** Journal of every provider call ({@code ai_run}): one row per call, started before it and closed after it. */
public interface AiRunJournal {
    UUID start(UUID owner, int slot, String model);

    void finish(UUID run, Consumption usage);

    void fail(UUID run, String error, Consumption usage);
}
