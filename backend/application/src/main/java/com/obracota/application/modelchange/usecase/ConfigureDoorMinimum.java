package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.port.DoorMinimum;
import com.obracota.domain.security.model.Actor;
import java.math.BigDecimal;
import java.util.UUID;

public record ConfigureDoorMinimum(ProjectVersions versions, DoorMinimum minimum, Transactions transactions) {
    public void set(Actor actor, UUID project, BigDecimal width) {
        Guards.person(actor);
        if (width != null && (width.signum() <= 0 || width.compareTo(BigDecimal.TEN) > 0 || width.scale() > 6))
            throw new IllegalArgumentException("Ancho mínimo inválido");
        transactions.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            if (width != null) minimum.minimumWidth(project, width);
            return null;
        });
    }
}
