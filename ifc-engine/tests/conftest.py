"""Shared fixtures of the IFC engine tests (H1-ESPECIFICACION §5.11).

``synthetic_model()`` builds, with ifcopenshell.api, the IFC4 model of §5.11. Units are set explicitly,
metres by default (``unit.assign_unit()`` without arguments would pick millimetres, 06 P16):

- a storey at +3 m, and a Model/Body/MODEL_VIEW subcontext, so IfcDiff compares geometry (§5.8, step 0);
- wall W1, 5 x 2.8 x 0.17 m with Pset_WallCommon.LoadBearing=False, voided by opening H1 (0.92 x 2.12 x 0.27 m);
- door D1, type P90 (0.9 x 2.1 m), fills H1 and is placed relative to it;
- wall W2 with opening H2 (0.92 x 2.12 m) and door D2, type P90, PredefinedType=USERDEFINED and
  ObjectType="Puerta cortafuego", placed relative to H2 (the #7006 trap);
- candidate types P90B (0.9 x 2.1 m, equal measure), P100 (1.0 x 2.1 m, incompatible) and P90C
  (0.9 x 2.1 m, PredefinedType=DOOR);
- one sample door per candidate type, S-P90B, S-P100 and S-P90C, each in its own opening (H3, H4, H5) and
  wall (W3, W4, W5): inspect() reads a type's measure from its doors, so without them it offers nothing;
- every door type with RepresentationMaps, one Pset_DoorCommon shared by D1 and D2, a
  Qto_DoorBaseQuantities on D1 and a slab with an IfcMaterial.

Real models come from DUPLEX_IFC (Duplex A, IFC2X3) and TEST_IFC (ReStage, IFC4). They are linked into a
temporary originals root, never copied or written. Without the variable, or without the file, the test
is skipped, unless REQUIRE_FIXTURES=1: then it fails, so a skipped test never passes for green.

TEST_IFC is any export of the ReStage model above ``ENGINE_PREVIEW_MAX_BYTES``: the published
``Restage_IP_ALL_MULTI_001.ifc`` (189,817,172 bytes, «190 MB») or the 186 MB copy of the step 5
experiments both pass. The tests never write its size: ``too_large_reason()`` derives the expected
message from the file itself, with the rounding the engine documents in ``store.preview_limit_reason``
(decimal megabytes). Inside the test container the variable points to the mount, e.g.
``-e TEST_IFC=/fixtures/restage.ifc -v "$TEST_IFC:/fixtures/restage.ifc:ro"`` (H1-ESPECIFICACION §5.12).

Every test gets its own ``ENGINE_ARTIFACTS`` (``artifact_store``). After the test it may only hold the
artifacts the engine indexed, which are the verified outputs of previews with ``ok=true`` (§5.11).
``preview``, ``build_revision`` and ``recipe_of`` call the HTTP routes the way the backend does.
"""
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.feature
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.type
import ifcopenshell.api.unit
import ifcopenshell.util.unit
import numpy as np
import pytest

from obracota_engine import artifacts, recipe, settings, store

DUPLEX_DOOR = "1hOSvn6df7F8_7GcBWlS8Z"
DUPLEX_TYPE = "2klOFZffH6WQFlV10uM1wF"

STOREY_ELEVATION = 3.0
WALL = {"length": 5.0, "height": 2.8, "thickness": 0.17}
OPENING_DEPTH = 0.27
WALL_SPACING = 2.0
OPENING_X = 1.0

# name: (width, height, PredefinedType). P90 is NOTDEFINED so that D2 may carry its own PredefinedType.
DOOR_TYPES = {
    "P90": (0.9, 2.1, "NOTDEFINED"),
    "P90B": (0.9, 2.1, "NOTDEFINED"),
    "P100": (1.0, 2.1, "NOTDEFINED"),
    "P90C": (0.9, 2.1, "DOOR"),
}

# door: (wall, opening, opening width, type, PredefinedType, ObjectType)
DOORS = {
    "D1": ("W1", "H1", 0.92, "P90", None, None),
    "D2": ("W2", "H2", 0.92, "P90", "USERDEFINED", "Puerta cortafuego"),
    "S-P90B": ("W3", "H3", 0.92, "P90B", None, None),
    "S-P100": ("W4", "H4", 1.02, "P100", None, None),
    "S-P90C": ("W5", "H5", 0.92, "P90C", None, None),
}
OPENING_HEIGHT = 2.12

LENGTH_UNITS = {"METRE": None, "MILLIMETRE": "MILLI"}


def translation(x: float, y: float, z: float) -> np.ndarray:
    matrix = np.eye(4)
    matrix[:3, 3] = (x, y, z)
    return matrix


@dataclass
class Synthetic:
    """The synthetic model and its named pieces: walls, openings, doors, types, the slab and the psets."""

    file: ifcopenshell.file
    items: dict = field(default_factory=dict)

    def __getitem__(self, name: str) -> ifcopenshell.entity_instance:
        return self.items[name]

    @property
    def scale(self) -> float:
        return ifcopenshell.util.unit.calculate_unit_scale(self.file)


def synthetic_model(length_unit: str = "METRE") -> Synthetic:
    """Build the §5.11 model. Lengths below are in metres; the API converts them to project units, except
    add_door_representation and the Overall* attributes, which take project units."""
    model = ifcopenshell.file(schema="IFC4")
    api = ifcopenshell.api
    items = {}

    project = api.root.create_entity(model, ifc_class="IfcProject", name="Proyecto sintético H1")
    units = [api.unit.add_si_unit(model, unit_type="LENGTHUNIT", prefix=LENGTH_UNITS[length_unit]),
             api.unit.add_si_unit(model, unit_type="AREAUNIT"),
             api.unit.add_si_unit(model, unit_type="VOLUMEUNIT"),
             api.unit.add_si_unit(model, unit_type="PLANEANGLEUNIT")]
    api.unit.assign_unit(model, units=units)
    scale = ifcopenshell.util.unit.calculate_unit_scale(model)

    model3d = api.context.add_context(model, context_type="Model")
    body = api.context.add_context(model, context_type="Model", context_identifier="Body",
                                   target_view="MODEL_VIEW", parent=model3d)
    items.update(project=project, body=body)

    site = api.root.create_entity(model, ifc_class="IfcSite", name="Sitio")
    building = api.root.create_entity(model, ifc_class="IfcBuilding", name="Edificio")
    storey = api.root.create_entity(model, ifc_class="IfcBuildingStorey", name="Nivel +3")
    api.aggregate.assign_object(model, products=[site], relating_object=project)
    api.aggregate.assign_object(model, products=[building], relating_object=site)
    api.aggregate.assign_object(model, products=[storey], relating_object=building)
    for product, matrix in ((site, np.eye(4)), (building, np.eye(4)),
                            (storey, translation(0, 0, STOREY_ELEVATION))):
        api.geometry.edit_object_placement(model, product=product, matrix=matrix)
    storey.Elevation = STOREY_ELEVATION / scale
    items.update(site=site, building=building, storey=storey)

    for name, (width, height, predefined) in DOOR_TYPES.items():
        door_type = api.root.create_entity(model, ifc_class="IfcDoorType", name=name, predefined_type=predefined)
        door_type.OperationType = "SINGLE_SWING_LEFT"
        representation = api.geometry.add_door_representation(
            model, context=body, overall_width=width / scale, overall_height=height / scale)
        api.geometry.assign_representation(model, product=door_type, representation=representation)
        items[name] = door_type

    for index, (door_name, (wall_name, opening_name, opening_width, type_name, predefined, object_type)) \
            in enumerate(DOORS.items()):
        y = index * WALL_SPACING
        wall_at = translation(0, y, STOREY_ELEVATION)
        wall = api.root.create_entity(model, ifc_class="IfcWall", name=wall_name)
        api.spatial.assign_container(model, products=[wall], relating_structure=storey)
        api.geometry.edit_object_placement(model, product=wall, matrix=wall_at)
        api.geometry.assign_representation(model, product=wall, representation=api.geometry.add_wall_representation(
            model, context=body, length=WALL["length"], height=WALL["height"], thickness=WALL["thickness"]))
        wall_common = api.pset.add_pset(model, product=wall, name="Pset_WallCommon")
        api.pset.edit_pset(model, pset=wall_common, properties={"LoadBearing": False})

        # The opening goes through the whole wall: 0.27 m deep, centred on the 0.17 m wall.
        opening_y = -(OPENING_DEPTH - WALL["thickness"]) / 2
        opening = api.root.create_entity(model, ifc_class="IfcOpeningElement", name=opening_name)
        api.feature.add_feature(model, feature=opening, element=wall)
        api.geometry.edit_object_placement(model, product=opening,
                                           matrix=wall_at @ translation(OPENING_X, opening_y, 0))
        api.geometry.assign_representation(model, product=opening, representation=api.geometry.add_wall_representation(
            model, context=body, length=opening_width, height=OPENING_HEIGHT, thickness=OPENING_DEPTH))

        width, height, _ = DOOR_TYPES[type_name]
        door = api.root.create_entity(model, ifc_class="IfcDoor", name=door_name, predefined_type=predefined)
        door.ObjectType = object_type
        api.spatial.assign_container(model, products=[door], relating_structure=storey)
        api.feature.add_filling(model, opening=opening, element=door)
        # After the filling exists, edit_object_placement places the door relative to the opening.
        api.geometry.edit_object_placement(
            model, product=door,
            matrix=wall_at @ translation(OPENING_X + (opening_width - width) / 2, WALL["thickness"] / 2, 0))
        api.type.assign_type(model, related_objects=[door], relating_type=items[type_name])
        door.OverallWidth, door.OverallHeight = width / scale, height / scale
        items.update({wall_name: wall, opening_name: opening, door_name: door})

    door_common = api.pset.add_pset(model, product=items["D1"], name="Pset_DoorCommon")
    api.pset.edit_pset(model, pset=door_common, properties={"FireRating": "EI 30", "IsExternal": False})
    api.pset.assign_pset(model, products=[items["D2"]], pset=door_common)
    quantities = api.pset.add_qto(model, product=items["D1"], name="Qto_DoorBaseQuantities")
    api.pset.edit_qto(model, qto=quantities, properties={"Width": 0.9 / scale, "Height": 2.1 / scale,
                                                         "Area": 0.9 * 2.1})
    items.update({"Pset_DoorCommon": door_common, "Qto_DoorBaseQuantities": quantities})

    slab = api.root.create_entity(model, ifc_class="IfcSlab", name="Losa", predefined_type="FLOOR")
    api.spatial.assign_container(model, products=[slab], relating_structure=storey)
    api.geometry.edit_object_placement(model, product=slab, matrix=translation(6, 0, STOREY_ELEVATION))
    api.geometry.assign_representation(model, product=slab, representation=api.geometry.add_slab_representation(
        model, context=body, depth=0.12, polyline=[(0, 0), (5, 0), (5, 4), (0, 4)]))
    concrete = api.material.add_material(model, name="Concreto 3000 psi", category="concrete")
    api.material.assign_material(model, products=[slab], type="IfcMaterial", material=concrete)
    items.update(slab=slab, concrete=concrete)
    return Synthetic(model, items)


@dataclass(frozen=True)
class VersionRef:
    """What the backend sends for a version: project, version and the SHA-256 of its bytes."""

    project: str
    version: str
    sha256: str
    path: Path

    def params(self) -> dict:
        return {"project": self.project, "version": self.version, "sha256": self.sha256}


class Originals:
    """A temporary ENGINE_ORIGINALS root laid out as the backend's volume: {root}/{project}/{version}."""

    def __init__(self, root: Path):
        self.root = root

    def _slot(self) -> tuple[str, str, Path]:
        project, version = str(uuid.uuid4()), str(uuid.uuid4())
        folder = self.root / project
        folder.mkdir(parents=True, exist_ok=True)
        return project, version, folder / version

    def add_model(self, model: ifcopenshell.file) -> VersionRef:
        project, version, path = self._slot()
        model.write(str(path))
        return VersionRef(project, version, store.sha_of(path), path)

    def write(self, data: bytes) -> VersionRef:
        project, version, path = self._slot()
        path.write_bytes(data)
        return VersionRef(project, version, store.sha_of(path), path)

    def link(self, source: Path) -> VersionRef:
        project, version, path = self._slot()
        path.symlink_to(source)
        return VersionRef(project, version, store.sha_of(path), path)


@pytest.fixture
def originals(tmp_path, monkeypatch) -> Originals:
    root = tmp_path / "originals"
    root.mkdir()
    monkeypatch.setattr(settings, "ENGINE_ORIGINALS", root)
    return Originals(root)


@pytest.fixture
def synthetic() -> Synthetic:
    return synthetic_model()


def _real_model(variable: str) -> Path:
    required = os.environ.get("REQUIRE_FIXTURES") == "1"
    value = os.environ.get(variable)
    problem = None
    if not value:
        problem = f"{variable} is not set"
    elif not Path(value).is_file():
        problem = f"{variable} points to {value}, which is not a file"
    if problem:
        if required:
            pytest.fail(f"REQUIRE_FIXTURES=1 and {problem}")
        pytest.skip(f"{problem}: set it to run this test")
    return Path(value)


def too_large_reason(path: Path) -> str:
    """The size reason the engine must give for ``path``, from its byte count: decimal megabytes, rounded.

    Written out here rather than calling ``store.preview_limit_reason``, so a change in the engine's wording or
    rounding still fails the tests."""
    megabytes = max(1, round(path.stat().st_size / 1_000_000))
    return f"El modelo supera el tamaño que H1 puede verificar ({megabytes} MB)."


@pytest.fixture
def duplex_path() -> Path:
    return _real_model("DUPLEX_IFC")


@pytest.fixture
def restage_path() -> Path:
    return _real_model("TEST_IFC")


@pytest.fixture
def duplex(originals, duplex_path) -> VersionRef:
    return originals.link(duplex_path)


def engine_temporaries() -> set[str]:
    """Directories that tempfile.TemporaryDirectory() leaves in the temp root (pytest's own are not)."""
    return {entry.name for entry in Path(tempfile.gettempdir()).iterdir() if entry.name.startswith("tmp")}


@pytest.fixture
def no_temporaries():
    """Fails the test if the engine leaves a temporary directory behind (§5.6, «Temporales»)."""
    before = engine_temporaries()
    yield
    left = engine_temporaries() - before
    assert not left, f"the engine left temporary directories: {sorted(left)}"


@pytest.fixture(scope="session", autouse=True)
def nothing_left_in_temporaries():
    """Session guard of §5.11: at the end no engine temporary directory may remain."""
    before = engine_temporaries()
    yield
    left = engine_temporaries() - before
    assert not left, f"the engine left temporary directories: {sorted(left)}"


@pytest.fixture(autouse=True)
def artifact_store(tmp_path, monkeypatch) -> Path:
    """A private ENGINE_ARTIFACTS for the test. Afterwards it holds nothing but indexed artifacts."""
    root = tmp_path / "artifacts"
    monkeypatch.setattr(settings, "ENGINE_ARTIFACTS", root)
    artifacts.reset()
    yield root
    expected = {f"{key}{suffix}" for key in artifacts.known() for suffix in (".ifc", ".json")}
    present = {entry.name for entry in root.iterdir()} if root.exists() else set()
    assert present == expected, f"ENGINE_ARTIFACTS holds files no ok preview left: {sorted(present - expected)}"
    with artifacts._guard:
        artifacts._index.clear()


def recipe_of(*operations) -> dict:
    return {"format": recipe.FORMAT, "operations": list(operations)}


def preview(client, ref, *operations, status: int = 200) -> dict:
    """The full /preview of a recipe (checks_only=false) as the backend calls it."""
    response = client.post("/preview", json={**ref.params(), "recipe": recipe_of(*operations)})
    assert response.status_code == status, response.text
    return response.json()


def build_revision(client, ref, operations, artifact=None):
    return client.post("/build", json={**ref.params(), "recipe": recipe_of(*operations), "artifact": artifact})


def report_layer(report: dict, number: int) -> dict:
    return next(layer for layer in report["validation"]["layers"] if layer["layer"] == number)
