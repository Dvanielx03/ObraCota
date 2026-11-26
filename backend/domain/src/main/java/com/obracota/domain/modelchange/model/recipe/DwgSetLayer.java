package com.obracota.domain.modelchange.model.recipe;

/** {@code dwg.set_layer}: moves the entity to another layer; the engine creates the layer if the drawing lacks it. */
public record DwgSetLayer(String id, String element, String layer) implements DwgOperation {
    public static final String OP = "dwg.set_layer";
    private static final java.util.regex.Pattern FORBIDDEN = java.util.regex.Pattern.compile("[<>/\\\\\":;?*|=`]");

    public DwgSetLayer {
        id = Operation.checkId(id);
        element = DwgHandle.require(element);
        layer = DwgOperation.text(layer, "Nombre de capa inválido");
        if (FORBIDDEN.matcher(layer).find()) throw new IllegalArgumentException("El nombre de capa tiene caracteres que AutoCAD no admite");
    }

    public String op() { return OP; }

    public DwgSetLayer withId(String value) { return new DwgSetLayer(value, element, layer); }

    public String target() { return OP + "|" + element; }
}
