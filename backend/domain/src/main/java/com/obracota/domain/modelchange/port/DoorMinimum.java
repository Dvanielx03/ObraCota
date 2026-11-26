package com.obracota.domain.modelchange.port;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

public interface DoorMinimum {
    Optional<BigDecimal> minimumWidth(UUID project);
    void minimumWidth(UUID project, BigDecimal width);
}
