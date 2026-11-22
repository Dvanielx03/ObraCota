package com.obracota.infrastructure.airun;

import com.obracota.application.airun.usecase.AiBudget;
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * The monthly AI cap, in cents, shared by the visual options and the document assistant. {@code application.yml} maps
 * the {@code AI_MONTHLY_LIMIT_CENTS} variable of Compose onto {@code ai.budget.monthly-limit-cents}; without either,
 * the cap is {@link AiBudget#DEFAULT_MONTHLY_LIMIT_CENTS}.
 */
@Validated
@ConfigurationProperties("ai.budget")
public record AiBudgetProperties(@PositiveOrZero @DefaultValue("" + AiBudget.DEFAULT_MONTHLY_LIMIT_CENTS) int monthlyLimitCents) {}
