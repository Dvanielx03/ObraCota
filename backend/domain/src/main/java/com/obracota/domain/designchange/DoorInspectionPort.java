package com.obracota.domain.designchange;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Reads one IFC door and the types it could take (the engine's {@code /inspect}). The pre-H1 {@code apply} was
 * retired in R4: revisions are only published from a verified {@code model_change} preview.
 */
public interface DoorInspectionPort {
    record DoorType(String id, String name, BigDecimal width, BigDecimal height, boolean compatible) {}
    record Door(String element, String name, String typeId, String typeName, BigDecimal width, BigDecimal height,
                String opening, List<BigDecimal> openingSize, String host, Boolean loadBearing, List<DoorType> options) {}
    Door inspect(UUID project, UUID version, String element) throws IOException;
}
