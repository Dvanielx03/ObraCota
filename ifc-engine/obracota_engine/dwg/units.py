"""$INSUNITS of a DWG in millimetres. ACIS writes 1.0 as its unit in every file; the real unit is the drawing's
(ACIS-LECTOR §1). A drawing without units (0) is read as millimetres and says so."""

# AutoCAD's $INSUNITS codes.
_TO_MM = {
    0: 1.0,            # unitless: read as millimetres
    1: 25.4,           # inches
    2: 304.8,          # feet
    3: 1_609_344.0,    # miles
    4: 1.0,            # millimetres
    5: 10.0,           # centimetres
    6: 1000.0,         # metres
    7: 1_000_000.0,    # kilometres
    8: 25.4e-6,        # microinches
    9: 0.0254,         # mils
    10: 914.4,         # yards
    11: 1e-7,          # ångström
    12: 1e-6,          # nanometres
    13: 1e-3,          # microns
    14: 100.0,         # decimetres
    15: 10_000.0,      # decametres
    16: 100_000.0,     # hectometres
    21: 1200.0 / 3937.0 * 1000.0,  # US survey feet
}
NAMES = {0: "sin unidad (leído como mm)", 1: "in", 2: "ft", 3: "mi", 4: "mm", 5: "cm", 6: "m", 7: "km",
         8: "µin", 9: "mil", 10: "yd", 11: "Å", 12: "nm", 13: "µm", 14: "dm", 15: "dam", 16: "hm", 21: "ft EE. UU."}


def to_mm(insunits: int) -> float:
    return _TO_MM.get(int(insunits), 1.0)


def name(insunits: int) -> str:
    return NAMES.get(int(insunits), f"código {insunits} (leído como mm)")
