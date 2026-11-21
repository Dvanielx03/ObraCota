package com.obracota.application.rulefinding;

import com.obracota.domain.designchange.BimEditPort.*;
import java.math.BigDecimal;
import java.util.List;

public final class DoorRules {
    private static final BigDecimal TOLERANCE = new BigDecimal("0.001");
    private DoorRules() {}
    public record Finding(String rule, String status, String explanation, String source, String element) {}

    public static List<Finding> evaluate(Door door, DoorType proposal, BigDecimal minimum) {
        var structure = new Finding("HOST_LOAD_BEARING", state(door.loadBearing()),
            door.loadBearing() == null ? "Falta una declaración portante única del anfitrión."
                : door.loadBearing() ? "El IFC declara portante el anfitrión de la puerta." : "El IFC declara el anfitrión como no portante.",
            "IfcRelFillsElement · IfcRelVoidsElement · Pset_WallCommon.LoadBearing", door.host() == null ? door.element() : door.host());

        var opening = door.openingSize();
        Boolean exceeds = opening == null || opening.size() != 2 ? null
            : proposal.width().subtract(opening.get(0)).compareTo(TOLERANCE) > 0 ||
              proposal.height().subtract(opening.get(1)).compareTo(TOLERANCE) > 0;
        var fit = new Finding("OPENING_SIZE", state(exceeds),
            exceeds == null ? "Falta un hueco rectangular alineado con la puerta."
                : "El hueco mide " + opening.get(0) + " × " + opening.get(1) + " m. El tipo propuesto mide " +
                  proposal.width() + " × " + proposal.height() + " m. Tolerancia 1 mm.",
            "IfcRelFillsElement · geometría local del IfcOpeningElement · ancho y alto nominales", door.element());

        Boolean below = minimum == null ? null : proposal.width().compareTo(minimum) < 0;
        var nominal = new Finding("MINIMUM_NOMINAL_WIDTH", state(below),
            below == null ? "La ingeniera aún no registró el ancho nominal mínimo."
                : "Ancho nominal propuesto " + proposal.width() + " m. Mínimo del proyecto " + minimum + " m.",
            "Tipo de puerta IFC · mínimo introducido por la ingeniera", door.element());
        return List.of(structure, fit, nominal);
    }
    private static String state(Boolean result) {
        return result == null ? "UNKNOWN" : result ? "WARNING" : "OK";
    }
}
