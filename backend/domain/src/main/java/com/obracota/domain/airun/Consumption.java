package com.obracota.domain.airun;
/** Null means the provider did not report the counter. */
public record Consumption(Integer inputTokens, Integer outputTokens, Integer totalTokens) {}
