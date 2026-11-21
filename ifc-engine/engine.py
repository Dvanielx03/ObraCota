import logging
import math
import tempfile
from pathlib import Path
from uuid import UUID

import ifcopenshell
import ifcopenshell.geom
import numpy as np
from fastapi import FastAPI, HTTPException
from ifcopenshell.api.type import assign_type
from ifcopenshell.util.element import get_pset, get_type, get_types
from ifcopenshell.util.unit import calculate_unit_scale
from starlette.background import BackgroundTask
from starlette.responses import FileResponse

app = FastAPI()
log = logging.getLogger(__name__)
TOLERANCE = .001


@app.get("/health")
def health():
    return {"status": "UP"}


def load(project, version, guid):
    path = Path("/srv/originals") / str(project) / str(version)
    if not path.is_file():
        raise HTTPException(404, "Versión IFC no disponible.")
    model = ifcopenshell.open(str(path), format=".ifc")
    try:
        door = model.by_guid(guid)
    except RuntimeError:
        raise HTTPException(404, "La pieza no aparece en el IFC.")
    if not door.is_a("IfcDoor"):
        raise HTTPException(422, "La edición se habilita para puertas IFC.")
    return model, door


def mesh(element):
    shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), element)
    return np.asarray(shape.geometry.verts).reshape(-1, 3)


def size(element, scale):
    return [round(x * scale, 6) if x and math.isfinite(x) and x > 0 else None
            for x in (element.OverallWidth, element.OverallHeight)]


def opening_and_host(door):
    fills = door.FillsVoids or ()
    if len(fills) != 1:
        return None, None
    opening = fills[0].RelatingOpeningElement
    voids = opening.VoidsElements or ()
    return opening, voids[0].RelatingBuildingElement if len(voids) == 1 else None


def opening_dimensions(opening, door):
    if opening is None:
        return None
    try:
        from ifcopenshell.util.placement import get_local_placement
        relation = np.linalg.solve(get_local_placement(door.ObjectPlacement),
                                   get_local_placement(opening.ObjectPlacement))[:3, :3]
        if not np.allclose(abs(relation), np.eye(3), atol=1e-6):
            return None
        vertices = mesh(opening)
        minimum, maximum = vertices.min(axis=0), vertices.max(axis=0)
        if np.any(maximum - minimum < 1e-5):
            return None
        corners = np.isclose(vertices, minimum, atol=1e-6, rtol=0) | np.isclose(vertices, maximum, atol=1e-6, rtol=0)
        if not corners.all() or len(np.unique(np.isclose(vertices, minimum, atol=1e-6, rtol=0), axis=0)) != 8:
            return None
        return [round(float(maximum[i] - minimum[i]), 6) for i in (0, 2)]
    except (RuntimeError, AttributeError, ValueError, np.linalg.LinAlgError):
        return None


def portante(host):
    if not host:
        return None
    values = []
    for part in (host, get_type(host)):
        value = get_pset(part, "Pset_WallCommon", "LoadBearing", should_inherit=False) if part else None
        if isinstance(value, bool):
            values.append(value)
    return values[0] if values and len(set(values)) == 1 else None


def inspect(model, door):
    opening, host = opening_and_host(door)
    unit = [u for u in model.by_type("IfcProject")[0].UnitsInContext.Units if getattr(u, "UnitType", None) == "LENGTHUNIT"]
    if len(unit) != 1:
        raise HTTPException(422, "El IFC necesita una unidad de longitud definida.")
    scale = calculate_unit_scale(model)
    current = size(door, scale)
    door_type = get_type(door)
    opening_size = opening_dimensions(opening, door)
    options = []
    if door_type:
        for candidate in model.by_type(door_type.is_a()):
            if candidate == door_type or not candidate.RepresentationMaps:
                continue
            exemplars = {
                tuple(size(item, scale)) for item in get_types(candidate)
                if item.is_a("IfcDoor")
            }
            if len(exemplars) != 1 or None in next(iter(exemplars)):
                continue
            width, height = next(iter(exemplars))
            compatible = bool(opening_size and None not in current
                              and abs(width - current[0]) <= TOLERANCE
                              and abs(height - current[1]) <= TOLERANCE
                              and width <= opening_size[0] + TOLERANCE
                              and height <= opening_size[1] + TOLERANCE)
            options.append({"id": candidate.GlobalId, "name": candidate.Name or candidate.GlobalId,
                            "width": width, "height": height, "compatible": compatible})
    return {"element": door.GlobalId, "name": door.Name or door.GlobalId,
            "typeId": door_type.GlobalId if door_type else None,
            "typeName": door_type.Name if door_type else None,
            "width": current[0], "height": current[1],
            "opening": opening.GlobalId if opening else None, "openingSize": opening_size,
            "host": host.GlobalId if host else None, "loadBearing": portante(host),
            "options": sorted(options, key=lambda option: (not option["compatible"], option["name"], option["id"]))}


@app.get("/inspect")
def inspect_door(project: UUID, version: UUID, element: str):
    try:
        return inspect(*load(project, version, element))
    except HTTPException:
        raise
    except (RuntimeError, ValueError, AttributeError, IndexError) as exc:
        log.info("Incompatible IFC for inspection: %s", type(exc).__name__)
        raise HTTPException(422, "El IFC no contiene datos suficientes para revisar esta puerta.")


@app.post("/apply")
def apply(project: UUID, version: UUID, element: str, type_id: str):
    tmp = tempfile.TemporaryDirectory()
    try:
        model, door = load(project, version, element)
        before = inspect(model, door)
        chosen = next((item for item in before["options"] if item["id"] == type_id), None)
        if not chosen or not chosen["compatible"]:
            raise HTTPException(422, "El motor solo aplica tipos compatibles con el hueco existente.")
        if door.ObjectPlacement is None:
            raise HTTPException(422, "Falta la colocación de la puerta.")
        from ifcopenshell.util.placement import get_local_placement
        placement = get_local_placement(door.ObjectPlacement)
        assign_type(model, related_objects=[door], relating_type=model.by_guid(type_id))
        scale = calculate_unit_scale(model)
        door.OverallWidth, door.OverallHeight = chosen["width"]/scale, chosen["height"]/scale
        path = Path(tmp.name) / "revision.ifc"
        model.write(path)
        reopened = ifcopenshell.open(path)
        door = reopened.by_guid(element)
        opening, host = opening_and_host(door)
        if (get_type(door).GlobalId != type_id or (opening and opening.GlobalId) != before["opening"]
                or (host and host.GlobalId) != before["host"] or not len(mesh(door))
                or size(door, scale) != [chosen["width"], chosen["height"]]
                or not np.allclose(placement, get_local_placement(door.ObjectPlacement))):
            raise HTTPException(422, "La revisión exportada no superó las comprobaciones de la pieza.")
        return FileResponse(path, media_type="application/octet-stream", background=BackgroundTask(tmp.cleanup))
    except HTTPException:
        tmp.cleanup()
        raise
    except Exception:
        tmp.cleanup()
        log.exception("IFC export failed")
        raise HTTPException(422, "No se pudo exportar y comprobar la revisión IFC.")

