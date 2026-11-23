"""ifc.set_material: one exterior finish for a list of pieces (H2 material, Fase H).

The operation gives every piece of ``elements`` the material of the chosen finish (an ``IfcMaterial`` named
after the chip, «Piedra · claro», with its category in IFC4) and a surface style with an approximate colour,
so other viewers show it too. What it writes depends on what the piece already has:

| The piece has | What changes |
|---|---|
| nothing, or a single ``IfcMaterial`` | its own association points to the new material |
| ``IfcMaterialLayerSetUsage`` | a copy of the layer set where only layer 1 (the exterior face in a Revit export) takes the new material; the other layers, thicknesses and the usage's direction and offset stay. The original set is never edited, because other pieces or the type share it |
| ``IfcMaterialList`` (IFC2X3) or ``IfcMaterialConstituentSet`` | it is not safe to say which part is the exterior: a copy with the finish added as one more material, and a ``MATERIAL_FINISH_ADDED`` warning |
| ``IfcMaterialProfileSet(Usage)`` | rejected: ``MATERIAL_NOT_SUPPORTED`` |

The style (``IfcSurfaceStyle`` with an ``IfcSurfaceStyleShading`` of the colour) is attached to the material
(``IfcMaterialDefinitionRepresentation``) and to the body items that belong to this piece alone. Items reached
through an ``IfcMappedItem`` or shared with another piece keep their style (``STYLE_SHARED_KEPT``), so the change
never reaches a piece outside the list. A whole body takes one colour: IFC cannot paint only the outer face of a
solid, and the notice ``STYLE_WHOLE_BODY`` says so.

IfcDiff does not compare materials or styles, so ``verify`` is the scope check of this operation: each piece of
the list has the new material where it should (and the rest of its layers as they were), and every other
element of the model keeps its material and the styles of its body.
"""
from dataclasses import dataclass
from typing import Optional

import ifcopenshell
import ifcopenshell.api.material
import ifcopenshell.guid
import ifcopenshell.api.style
import ifcopenshell.util.element
import ifcopenshell.util.representation

from ..texts import short
from .base import Applied, Operation, Rejected, by_guid, finding, issue

NAME = "ifc.set_material"
SOURCE = "ifcopenshell.api.material · ifcopenshell.api.style"

ELEMENT_NOT_FOUND = "La pieza {guid} no aparece en el IFC."
NOT_AN_ELEMENT = "{guid} no es una pieza constructiva (IfcElement) del modelo."
MATERIAL_NOT_SUPPORTED = ("{name} tiene un material por perfiles ({kind}); H2 no cambia el acabado de perfiles. "
                          "Quítala de la lista.")
REPEATED = "{name} ya recibe un material en la operación {other} de esta receta."
LAYER_REPLACED = ("En {n} piezas con capas se cambió solo la capa 1 ({before} → {after}), que en una exportación de "
                  "Revit es la cara exterior. Las demás capas y sus espesores no cambian; confírmalo en el modelo.")
FINISH_ADDED = ("{name} tiene una lista de materiales sin capas ({kind}): no se puede saber cuál es la cara "
                "exterior, así que se añadió «{material}» como acabado y los materiales anteriores se conservan.")
STYLE_WHOLE_BODY = ("El color de «{material}» se aplica al cuerpo completo de {n} piezas: el IFC no permite pintar "
                    "solo la cara exterior de un sólido. El material de cada pieza sí distingue sus capas.")
STYLE_SHARED_KEPT = ("{n} piezas comparten su geometría con otras (o la usan por un mapeo): conservan su color en "
                     "otros visores, aunque su material sí cambia.")

PROFILE_KINDS = ("IfcMaterialProfileSet", "IfcMaterialProfileSetUsage", "IfcMaterialProfile")


@dataclass(frozen=True)
class Piece:
    element: ifcopenshell.entity_instance
    kind: str                                   # none, single, layers, list, constituents
    current: Optional[ifcopenshell.entity_instance]


def _name(element) -> str:
    return short(element.Name or element.GlobalId)


def _own_material(element):
    """The material associated with the piece itself (not inherited from its type), usage included."""
    for rel in getattr(element, "HasAssociations", None) or ():
        if rel.is_a("IfcRelAssociatesMaterial"):
            return rel.RelatingMaterial
    return None


def _material_of(element):
    return _own_material(element) or ifcopenshell.util.element.get_material(element, should_skip_usage=False)


def _kind(material) -> str:
    if material is None:
        return "none"
    if material.is_a("IfcMaterial"):
        return "single"
    if material.is_a("IfcMaterialLayerSetUsage") or material.is_a("IfcMaterialLayerSet"):
        return "layers"
    if material.is_a("IfcMaterialList"):
        return "list"
    if material.is_a("IfcMaterialConstituentSet"):
        return "constituents"
    if material.is_a() in PROFILE_KINDS:
        return "profiles"
    return "other"


def _layer_set(material):
    return material.ForLayerSet if material.is_a("IfcMaterialLayerSetUsage") else material


def _piece(model, guid: str) -> Piece:
    element = by_guid(model, guid)
    if element is None:
        raise Rejected("ELEMENT_NOT_FOUND", ELEMENT_NOT_FOUND.format(guid=guid))
    if not element.is_a("IfcElement") or element.is_a("IfcFeatureElement"):
        raise Rejected("NOT_AN_ELEMENT", NOT_AN_ELEMENT.format(guid=guid))
    current = _material_of(element)
    kind = _kind(current)
    if kind in ("profiles", "other") or (kind == "layers" and not _layer_set(current).MaterialLayers):
        raise Rejected("MATERIAL_NOT_SUPPORTED",
                       MATERIAL_NOT_SUPPORTED.format(name=_name(element), kind=current.is_a()))
    return Piece(element, kind, current)


def check(model, op, operations=()) -> None:
    mine = set(op.elements)
    for other in operations:
        if other.op != NAME or other.id == op.id:
            continue
        shared = mine & set(other.elements)
        if shared:
            guid = sorted(shared)[0]
            element = by_guid(model, guid)
            raise Rejected("MATERIAL_TARGET_REPEATED",
                           REPEATED.format(name=_name(element) if element is not None else guid, other=other.id))
    for guid in op.elements:
        _piece(model, guid)


# --- Writing -------------------------------------------------------------------------------------------

def _model_context(model):
    context = ifcopenshell.util.representation.get_context(model, "Model", "Body", "MODEL_VIEW")
    if context is None:
        context = next((c for c in model.by_type("IfcGeometricRepresentationContext")
                        if c.ContextType == "Model" and not c.is_a("IfcGeometricRepresentationSubContext")), None)
    return context


def _rgb(color: str) -> dict:
    return {"Red": int(color[1:3], 16) / 255, "Green": int(color[3:5], 16) / 255, "Blue": int(color[5:7], 16) / 255}


def _finish_material(model, op):
    """The IfcMaterial of the finish and its surface style. A material of that name with a style is reused, so
    applying the same finish twice does not multiply materials."""
    for material in model.by_type("IfcMaterial"):
        if material.Name == op.material and _style_of_material(material) is not None:
            return material, _style_of_material(material), False
    category = op.category if model.schema != "IFC2X3" else None
    material = ifcopenshell.api.material.add_material(model, name=op.material, category=category)
    style = ifcopenshell.api.style.add_style(model, name=op.material)
    ifcopenshell.api.style.add_surface_style(model, style=style, ifc_class="IfcSurfaceStyleShading",
                                             attributes={"SurfaceColour": {"Name": None, **_rgb(op.color)}})
    context = _model_context(model)
    if context is not None:
        ifcopenshell.api.style.assign_material_style(model, material=material, style=style, context=context,
                                                     should_use_presentation_style_assignment=model.schema == "IFC2X3")
    return material, style, True


def _style_of_material(material):
    for representation in getattr(material, "HasRepresentation", None) or ():
        for item in representation.Representations or ():
            for styled in item.Items or ():
                for style in _styles(styled):
                    if style.is_a("IfcSurfaceStyle"):
                        return style
    return None


def _styles(styled_item) -> list:
    found = []
    for style in styled_item.Styles or ():
        if style.is_a("IfcPresentationStyleAssignment"):
            found.extend(style.Styles or ())
        else:
            found.append(style)
    return found


def _associate(model, element, relating) -> None:
    """Point the piece's own material association to ``relating``, leaving the other pieces of a shared
    association where they were."""
    for rel in list(getattr(element, "HasAssociations", None) or ()):
        if not rel.is_a("IfcRelAssociatesMaterial"):
            continue
        others = [obj for obj in rel.RelatedObjects if obj != element]
        if others:
            rel.RelatedObjects = others
        else:
            model.remove(rel)
    model.create_entity("IfcRelAssociatesMaterial", ifcopenshell.guid.new(), element.OwnerHistory, None, None,
                        [element], relating)


def _copy_layers(model, layer_set, material, cache: dict):
    """One copy of ``layer_set`` per finish, with layer 1 made of ``material``."""
    if layer_set.id() in cache:
        return cache[layer_set.id()]
    layers = []
    for index, layer in enumerate(layer_set.MaterialLayers):
        copy = ifcopenshell.util.element.copy(model, layer)
        if index == 0:
            copy.Material = material
        layers.append(copy)
    name = f"{layer_set.LayerSetName or 'Capas'} · {material.Name}"[:255]
    attributes = {"MaterialLayers": layers, "LayerSetName": name}
    copied = model.create_entity("IfcMaterialLayerSet", **attributes)
    cache[layer_set.id()] = copied
    return copied


def _restyle(model, element, style, used: dict, assignment: list) -> bool:
    """Styles the body items that belong to this piece alone. False when some item is mapped or shared.

    The item's previous IfcStyledItem is removed and a new one created. The previous styles themselves are never
    edited: a Revit export shares one IfcPresentationStyleAssignment among many items, and editing it (what
    ``assign_representation_styles`` does) would recolour pieces outside the list."""
    representation = getattr(element, "Representation", None)
    if representation is None:
        return True
    alone = True
    for shape in representation.Representations or ():
        if shape.RepresentationIdentifier not in (None, "Body", "Facetation"):
            continue
        items = shape.Items or ()
        if used.get(shape.id(), 0) > 1 or any(item.is_a("IfcMappedItem") for item in items) or any(
                len([u for u in model.get_inverse(item) if u.is_a("IfcShapeRepresentation")]) > 1 for item in items):
            alone = False
            continue
        for item in items:
            for styled in list(getattr(item, "StyledByItem", None) or ()):
                model.remove(styled)
            if model.schema == "IFC2X3" and not assignment:
                assignment.append(model.create_entity("IfcPresentationStyleAssignment", [style]))
            model.create_entity("IfcStyledItem", item, [assignment[0] if assignment else style], None)
    return alone


def _shape_users(model) -> dict:
    users = {}
    for definition in model.by_type("IfcProductDefinitionShape"):
        for shape in definition.Representations or ():
            users[shape.id()] = users.get(shape.id(), 0) + len(model.get_inverse(definition))
    return users


def _describe_material(material) -> str:
    if material is None:
        return "sin material"
    if material.is_a("IfcMaterial"):
        return material.Name or "IfcMaterial"
    if material.is_a("IfcMaterialLayerSetUsage") or material.is_a("IfcMaterialLayerSet"):
        layers = _layer_set(material).MaterialLayers
        first = layers[0].Material.Name if layers and layers[0].Material else "?"
        return f"{_layer_set(material).LayerSetName or 'Capas'} (capa 1: {first})"
    return material.is_a()


def apply(model, op) -> Applied:
    pieces = [_piece(model, guid) for guid in op.elements]
    previous = {}
    for piece in pieces:
        label = short(_describe_material(piece.current))
        previous[label] = previous.get(label, 0) + 1
    material, style, created = _finish_material(model, op)
    users = _shape_users(model)
    copies, findings, assignment = {}, [], []
    layered, replaced_names, shared = 0, set(), 0
    for piece in pieces:
        element = piece.element
        if piece.kind in ("none", "single"):
            _associate(model, element, material)
        elif piece.kind == "layers":
            original = _layer_set(piece.current)
            first = original.MaterialLayers[0].Material
            replaced_names.add(short(first.Name if first is not None else "sin material"))
            copied = _copy_layers(model, original, material, copies)
            if piece.current.is_a("IfcMaterialLayerSetUsage"):
                usage = model.create_entity("IfcMaterialLayerSetUsage", copied, piece.current.LayerSetDirection,
                                            piece.current.DirectionSense, piece.current.OffsetFromReferenceLine)
                if model.schema != "IFC2X3":
                    usage.ReferenceExtent = piece.current.ReferenceExtent
                _associate(model, element, usage)
            else:
                _associate(model, element, copied)
            layered += 1
        elif piece.kind == "list":
            _associate(model, element, model.create_entity(
                "IfcMaterialList", list(piece.current.Materials or ()) + [material]))
            findings.append(finding("MATERIAL_FINISH_ADDED", FINISH_ADDED.format(
                name=_name(element), kind=piece.current.is_a(), material=short(op.material)), SOURCE, element.GlobalId))
        else:  # constituents
            constituents = [ifcopenshell.util.element.copy(model, c) for c in piece.current.MaterialConstituents or ()]
            constituents.append(model.create_entity("IfcMaterialConstituent", Name="Acabado exterior", Material=material,
                                                    Category=op.category))
            _associate(model, element, model.create_entity(
                "IfcMaterialConstituentSet", Name=f"{piece.current.Name or 'Constituyentes'} · {op.material}"[:255],
                MaterialConstituents=constituents))
            findings.append(finding("MATERIAL_FINISH_ADDED", FINISH_ADDED.format(
                name=_name(element), kind=piece.current.is_a(), material=short(op.material)), SOURCE, element.GlobalId))
        if not _restyle(model, element, style, users, assignment):
            shared += 1
    if layered:
        findings.append(finding("MATERIAL_EXTERIOR_LAYER", LAYER_REPLACED.format(
            n=layered, before=", ".join(sorted(replaced_names)), after=short(op.material)), SOURCE, op.element))
    findings.append(finding("STYLE_WHOLE_BODY", STYLE_WHOLE_BODY.format(material=short(op.material), n=len(pieces)),
                            SOURCE, op.element, status="INFO"))
    if shared:
        findings.append(finding("STYLE_SHARED_KEPT", STYLE_SHARED_KEPT.format(n=shared), SOURCE, op.element))
    before = {"pieces": len(pieces),
              "materials": [{"material": label, "pieces": n} for label, n in sorted(previous.items())]}
    after = {"material": op.material, "category": op.category, "color": op.color, "pieces": len(pieces),
             "layered": layered, "new_material": created, "schema_category": model.schema != "IFC2X3"}
    return Applied(before, after, findings)


def declare(model_before, op) -> dict:
    """IfcDiff does not see materials or styles; geometry is allowed because a viewer may hash the styled body
    differently. ``verify`` checks the rest."""
    return {guid: ["geometry_changed"] for guid in op.elements}


# --- Verification --------------------------------------------------------------------------------------

def _signature(material):
    """What a piece's material is, as plain data, so two files can be compared."""
    if material is None:
        return None
    if material.is_a("IfcMaterial"):
        return ("IfcMaterial", material.Name)
    if material.is_a("IfcMaterialLayerSetUsage") or material.is_a("IfcMaterialLayerSet"):
        layers = tuple((layer.Material.Name if layer.Material else None, round(float(layer.LayerThickness), 9))
                       for layer in _layer_set(material).MaterialLayers)
        usage = ((material.LayerSetDirection, material.DirectionSense, round(float(material.OffsetFromReferenceLine), 9))
                 if material.is_a("IfcMaterialLayerSetUsage") else None)
        return ("layers", layers, usage)
    if material.is_a("IfcMaterialList"):
        return ("list", tuple(m.Name for m in material.Materials or ()))
    if material.is_a("IfcMaterialConstituentSet"):
        return ("constituents", tuple((c.Name, c.Material.Name if c.Material else None)
                                      for c in material.MaterialConstituents or ()))
    return (material.is_a(), material.id())


def _body_styles(element) -> list:
    representation = getattr(element, "Representation", None)
    found = []
    for shape in (representation.Representations if representation is not None else ()) or ():
        for item in shape.Items or ():
            for styled in getattr(item, "StyledByItem", None) or ():
                found.append((item.id(), tuple(sorted(str(s.Name) for s in _styles(styled)))))
    return sorted(found)


def verify(base, revised, op, operations=()) -> list:
    issues = []
    listed = set()
    for other in (*operations, op):
        if other.op == NAME:
            listed |= set(other.elements)
    for guid in op.elements:
        old, new = by_guid(base, guid), by_guid(revised, guid)
        if new is None:
            issues.append(issue("ELEMENT_MISSING", f"La pieza {guid} no aparece en la revisión."))
            continue
        before, after = _material_of(old), _material_of(new)
        kind = _kind(before)
        if kind in ("none", "single"):
            ok = after is not None and after.is_a("IfcMaterial") and after.Name == op.material
        elif kind == "layers":
            old_sig, new_sig = _signature(before), _signature(after)
            ok = (new_sig is not None and new_sig[0] == "layers" and len(new_sig[1]) == len(old_sig[1])
                  and new_sig[1][0] == (op.material, old_sig[1][0][1]) and new_sig[1][1:] == old_sig[1][1:]
                  and new_sig[2] == old_sig[2])
        elif kind == "list":
            ok = _signature(after) == ("list", _signature(before)[1] + (op.material,))
        else:
            ok = after is not None and after.is_a("IfcMaterialConstituentSet") and \
                 _signature(after)[1][:-1] == _signature(before)[1] and _signature(after)[1][-1][1] == op.material
        if not ok:
            issues.append(issue("MATERIAL_NOT_WRITTEN", f"{_name(new)} no quedó con «{short(op.material)}» como se pidió."))
        if old.ObjectPlacement is not None and (new.ObjectPlacement is None
                                                or old.ObjectPlacement.id() != new.ObjectPlacement.id()):
            issues.append(issue("PLACEMENT_CHANGED", f"La colocación de {_name(new)} cambió."))
    # Every other element keeps its material and its styles: the scope IfcDiff cannot see.
    for element in base.by_type("IfcElement"):
        if element.GlobalId in listed:
            continue
        other = by_guid(revised, element.GlobalId)
        if other is None:
            continue
        if _signature(_material_of(element)) != _signature(_material_of(other)):
            issues.append(issue("MATERIAL_OUT_OF_SCOPE", f"El material de {_name(element)} cambió sin estar en la lista."))
        elif _body_styles(element) != _body_styles(other):
            issues.append(issue("STYLE_OUT_OF_SCOPE", f"El color de {_name(element)} cambió sin estar en la lista."))
    return issues


OPERATION = Operation(NAME, check, apply, declare, verify)
