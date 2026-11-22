package com.obracota.domain.modelchange.model.recipe;

/** {@code ifc.change_type}: gives the element another type of the same measure (in H1, a door). */
public record ChangeType(String id, String element, String typeId) implements Operation {
    public static final String OP = "ifc.change_type";

    public ChangeType {
        id = Operation.checkId(id);
        element = GlobalId.require(element);
        typeId = GlobalId.require(typeId);
    }

    public String op() { return OP; }

    public ChangeType withId(String value) { return new ChangeType(value, element, typeId); }

    public String target() { return OP + "|" + element; }
}
