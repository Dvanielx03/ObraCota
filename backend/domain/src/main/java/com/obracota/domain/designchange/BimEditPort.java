package com.obracota.domain.designchange;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public interface BimEditPort {
    record DoorType(String id, String name, BigDecimal width, BigDecimal height, boolean compatible) {}
    record Door(String element, String name, String typeId, String typeName, BigDecimal width, BigDecimal height,
                String opening, List<BigDecimal> openingSize, String host, Boolean loadBearing, List<DoorType> options) {}
    Door inspect(UUID project, UUID version, String element) throws IOException;
    InputStream apply(UUID project, UUID version, String element, String typeId) throws IOException;
}
