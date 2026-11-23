package com.obracota.application.modelchange.usecase;

import com.obracota.application.rulefinding.DoorRules;
import com.obracota.domain.designchange.DoorInspectionPort;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * The door review of the routes before H1, field by field: it is stored as {@code legacy_review} and the
 * {@code /design-changes} facade returns it unchanged as {@code review}.
 */
public record DoorReview(DoorInspectionPort.Door door, DoorInspectionPort.DoorType proposal, List<DoorRules.Finding> findings, Estimate estimate) {
    public record Price(String typeId, BigDecimal amount, String source, LocalDate date) {}

    public record Estimate(int beforeQuantity, int afterQuantity, Price before, Price after, BigDecimal difference) {}
}
