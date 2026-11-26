"""DWG revisions written as DXF (dwg/revision.py): the dwg.* operations through /preview and /build.

Synthetic tests run always: a DXF original made here with ezdxf (TEXT, MTEXT, LINE, INSERT with an attribute,
DIMENSION, a 3DFACE) goes through the HTTP routes as the backend calls them. They pin the recipe shape, every
operation's checks, before/after, the verification layers (1: ezdxf reads it back, 2: LibreDWG reads it as the
viewer will, 6: nothing else changed) and the artifact /build sends.

Sample tests need the four Autodesk sample DWGs (``DWG_SAMPLES``, the folder docs/mvp/modelos-nuevos-26-11/dwg).
Without it they are skipped, unless ``REQUIRE_FIXTURES=1``: then they fail. Each sample is converted to DXF by
LibreDWG, changed and read back.
"""
import os
from pathlib import Path

import ezdxf
import pytest
from fastapi.testclient import TestClient

import engine
from obracota_engine import recipe, settings
from obracota_engine.dwg import revision

from conftest import build_revision, preview, recipe_of, report_layer

client = TestClient(engine.app)
SAMPLES = ("architectural_-_annotation_scaling_and_multileaders.dwg", "architectural_example-imperial.dwg",
           "blocks_and_tables_-_metric.dwg", "civil_example-imperial.dwg")


@pytest.fixture(autouse=True)
def dxf_cache(tmp_path, monkeypatch) -> Path:
    root = tmp_path / "dxf-cache"
    monkeypatch.setattr(settings, "ENGINE_DXF_CACHE", root)
    return root


def _drawing(tmp_path: Path, units: int = 4) -> tuple[Path, dict]:
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = units
    msp = doc.modelspace()
    doc.layers.add("A-TEXT", color=2)
    doc.layers.add("A-WALL", color=1)
    handles = {}
    handles["text"] = msp.add_text("PLANTA BAJA", dxfattribs={"layer": "A-TEXT", "height": 250, "insert": (1000, 2000)}).dxf.handle
    handles["mtext"] = msp.add_mtext("{\\LSALA\\P\\H0.6667x;\\lPISO MADERA}", dxfattribs={"layer": "A-TEXT", "char_height": 200,
                                                                                         "insert": (4000, 2000)}).dxf.handle
    handles["line"] = msp.add_line((0, 0), (6000, 0), dxfattribs={"layer": "A-WALL"}).dxf.handle
    block = doc.blocks.new("PUERTA")
    block.add_line((0, 0), (900, 0))
    block.add_arc((0, 0), 900, 0, 90)
    block.add_attdef("COD", (0, -200), dxfattribs={"height": 100})
    insert = msp.add_blockref("PUERTA", (2000, 0), dxfattribs={"layer": "A-WALL"})
    insert.add_attrib("COD", "P-01", (2000, -200), dxfattribs={"height": 100})
    handles["insert"] = insert.dxf.handle
    handles["attrib"] = insert.attribs[0].dxf.handle
    dimension = msp.add_linear_dim(base=(0, -1000), p1=(0, 0), p2=(6000, 0), dimstyle="EZDXF", dxfattribs={"layer": "A-TEXT"})
    dimension.render()
    handles["dimension"] = dimension.dimension.dxf.handle
    handles["face"] = msp.add_3dface([(0, 0, 0), (100, 0, 0), (100, 100, 0)]).dxf.handle
    path = tmp_path / "plano.dxf"
    doc.saveas(path)
    return path, handles


@pytest.fixture
def plan(originals, tmp_path):
    path, handles = _drawing(tmp_path)
    return originals.write(path.read_bytes()), handles


def op(kind: str, element: str, number: int = 1, **fields) -> dict:
    return {"id": f"op-{number}", "op": kind, "element": element, **fields}


def _revision(response) -> "ezdxf.document.Drawing":
    assert response.status_code == 200, response.text
    return ezdxf.read(__import__("io").StringIO(response.content.decode("utf-8")))


# --- Recipe shape -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    {"id": "op-1", "op": "dwg.set_text", "element": "1a", "text": "X"},          # handle in lower case
    {"id": "op-1", "op": "dwg.set_text", "element": "1A", "text": ""},
    {"id": "op-1", "op": "dwg.set_text", "element": "1A", "text": "a\nb"},
    {"id": "op-1", "op": "dwg.set_color", "element": "1A", "color": 257},
    {"id": "op-1", "op": "dwg.set_color", "element": "1A", "color": "1"},
    {"id": "op-1", "op": "dwg.move", "element": "1A", "dx": 0, "dy": 0, "unit": "mm"},
    {"id": "op-1", "op": "dwg.move", "element": "1A", "dx": 1, "dy": 0, "unit": "yd"},
    {"id": "op-1", "op": "dwg.move", "element": "1A", "dx": 1, "dy": 0, "unit": "mm", "dz": 3},
])
def test_malformed_dwg_operations_are_rejected(raw):
    with pytest.raises(Exception) as caught:
        recipe.parse_recipe(recipe_of(raw))
    assert getattr(caught.value, "code", None) == "RECIPE_INVALID"


def test_dwg_and_ifc_operations_do_not_mix():
    with pytest.raises(Exception) as caught:
        recipe.parse_recipe(recipe_of(op("dwg.set_text", "1A", text="X"),
                                      {"id": "op-2", "op": "ifc.change_type", "element": "1" * 22, "type_id": "2" * 22}))
    assert caught.value.code == "RECIPE_INVALID"


def test_dwg_operations_need_a_drawing(originals, synthetic):
    ref = originals.add_model(synthetic.file)
    body = preview(client, ref, op("dwg.set_text", "1A", text="X"), status=400)
    assert body["code"] == "RECIPE_INVALID"


def test_a_drawing_takes_only_dwg_operations(plan):
    ref, _ = plan
    body = preview(client, ref, {"id": "op-1", "op": "ifc.change_type", "element": "1" * 22, "type_id": "2" * 22}, status=400)
    assert body["code"] == "RECIPE_INVALID"


# --- Checks -----------------------------------------------------------------------------------------------------

def test_checks_only_reports_each_operation(plan):
    ref, handles = plan
    response = client.post("/preview", json={**ref.params(), "checks_only": True, "recipe": recipe_of(
        op("dwg.set_text", handles["text"], 1, text="PLANTA ALTA"),
        op("dwg.set_text", handles["line"], 2, text="X"),
        op("dwg.set_layer", "FFFFF", 3, layer="A-TEXT"),
        op("dwg.move", handles["face"], 4, dx=10, dy=0, unit="mm"))})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is False
    codes = [result["errors"][0]["code"] if result["errors"] else None for result in body["operations"]]
    assert codes == [None, "TEXT_NOT_EDITABLE", "ENTITY_NOT_FOUND", None]


def test_a_rejected_recipe_writes_nothing(plan, no_temporaries):
    ref, handles = plan
    report = preview(client, ref, op("dwg.set_text", handles["text"], text="PLANTA BAJA"))
    assert report["ok"] is False
    assert "artifact" not in report
    assert report["operations"][0]["errors"][0]["code"] == "VALUE_UNCHANGED"
    assert report_layer(report, 2)["status"] == "NOT_RUN"


def test_a_drawing_without_units_moves_only_in_drawing_units(originals, tmp_path):
    path, handles = _drawing(tmp_path, units=0)
    ref = originals.write(path.read_bytes())
    report = preview(client, ref, op("dwg.move", handles["line"], dx=500, dy=0, unit="mm"))
    assert report["operations"][0]["errors"][0]["code"] == "UNITS_UNKNOWN"
    assert preview(client, ref, op("dwg.move", handles["line"], dx=500, dy=0, unit="drawing"))["ok"] is True


# --- Every operation, verified and built ---------------------------------------------------------------------------

def test_set_text_on_text_mtext_attribute_and_dimension(plan, no_temporaries):
    ref, handles = plan
    report = preview(client, ref,
                     op("dwg.set_text", handles["text"], 1, text="REVISADO OBRA"),
                     op("dwg.set_text", handles["mtext"], 2, text="COCINA {nueva}"),
                     op("dwg.set_text", handles["attrib"], 3, text="P-02"),
                     op("dwg.set_text", handles["dimension"], 4, text="6000 VERIFICAR"))
    assert report["ok"] is True, report["errors"]
    first = report["operations"][0]
    assert first["before"] == {"type": "TEXT", "layer": "A-TEXT", "text": "PLANTA BAJA"}
    assert first["after"] == {"text": "REVISADO OBRA"}
    assert report["operations"][1]["after"]["text"] == "COCINA \\{nueva\\}"
    assert {layer["layer"]: layer["status"] for layer in report["validation"]["layers"]} == {1: "PASS", 2: "PASS", 6: "PASS"}
    assert report["quantities"] == []
    assert any(finding["rule"] == "DWG_NO_QUANTITIES" for finding in report["findings"])
    assert any(finding["rule"] == "DWG_DIMENSION_OVERRIDE" for finding in report["findings"])
    assert report["base"]["schema"] == "DXF" and report["output"]["format"] == "DXF"
    built = build_revision(client, ref, [op("dwg.set_text", handles["text"], 1, text="REVISADO OBRA"),
                                         op("dwg.set_text", handles["mtext"], 2, text="COCINA {nueva}"),
                                         op("dwg.set_text", handles["attrib"], 3, text="P-02"),
                                         op("dwg.set_text", handles["dimension"], 4, text="6000 VERIFICAR")],
                           report["artifact"]["id"])
    assert built.headers["X-ObraCota-Rebuilt"] == "false"
    assert built.headers["X-ObraCota-Output-Sha256"] == report["artifact"]["sha256"]
    doc = _revision(built)
    assert doc.entitydb[handles["text"]].dxf.text == "REVISADO OBRA"
    assert doc.entitydb[handles["mtext"]].plain_text() == "COCINA {nueva}"
    assert doc.entitydb[handles["attrib"]].dxf.text == "P-02"
    assert doc.entitydb[handles["dimension"]].dxf.text == "6000 VERIFICAR"


def test_set_layer_creates_the_layer_and_set_color(plan):
    ref, handles = plan
    report = preview(client, ref, op("dwg.set_layer", handles["line"], 1, layer="A-WALL-DEMO"),
                     op("dwg.set_color", handles["insert"], 2, color=3))
    assert report["ok"] is True, report["errors"]
    assert report["operations"][0]["after"] == {"layer": "A-WALL-DEMO", "created": True}
    assert report["operations"][1]["before"]["color"] == 256 and report["operations"][1]["after"] == {"color": 3}
    doc = _revision(build_revision(client, ref, [op("dwg.set_layer", handles["line"], 1, layer="A-WALL-DEMO"),
                                                 op("dwg.set_color", handles["insert"], 2, color=3)], None))
    assert "A-WALL-DEMO" in doc.layers
    assert doc.entitydb[handles["line"]].dxf.layer == "A-WALL-DEMO"
    assert doc.entitydb[handles["insert"]].dxf.color == 3


def test_move_converts_millimetres_to_drawing_units(originals, tmp_path):
    path, handles = _drawing(tmp_path, units=1)  # inches
    ref = originals.write(path.read_bytes())
    report = preview(client, ref, op("dwg.move", handles["insert"], dx=508, dy=-254, unit="mm"))
    assert report["ok"] is True, report["errors"]
    result = report["operations"][0]
    assert result["before"]["position"] == [2000.0, 0.0]
    assert result["after"]["position"] == [2020.0, -10.0]
    assert result["after"]["unit"] == "in"
    # The attribute travels with its insert: it is declared, so layer 6 passes.
    assert {entry["handle"] for entry in result["declared"]} == {handles["insert"], handles["attrib"]}
    doc = _revision(build_revision(client, ref, [op("dwg.move", handles["insert"], dx=508, dy=-254, unit="mm")], report["artifact"]["id"]))
    assert tuple(doc.entitydb[handles["attrib"]].dxf.insert)[:2] == (2020.0, -210.0)


def test_add_note_draws_a_cloud_and_a_note_on_the_revision_layer(plan):
    ref, handles = plan
    report = preview(client, ref, op("dwg.add_note", handles["insert"], text="Verificar giro de la puerta"))
    assert report["ok"] is True, report["errors"]
    after = report["operations"][0]["after"]
    assert after["layer"] == revision.NOTE_LAYER
    doc = _revision(build_revision(client, ref, [op("dwg.add_note", handles["insert"], text="Verificar giro de la puerta")], report["artifact"]["id"]))
    note, cloud = doc.entitydb[after["note"]], doc.entitydb[after["cloud"]]
    assert note.dxftype() == "MTEXT" and note.plain_text() == "Verificar giro de la puerta"
    assert cloud.dxftype() == "LWPOLYLINE" and cloud.closed and cloud.dxf.layer == revision.NOTE_LAYER
    added = {entry["guid"] for entry in report["diff"]["added"]}
    assert added == {after["note"], after["cloud"]}
    assert report["diff"]["unexpected"] == [] and report["diff"]["drawing"] is True


def test_a_solid_cannot_be_moved():
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    solid = doc.modelspace().add_3dsolid()
    move = recipe.parse_operation(op("dwg.move", solid.dxf.handle, dx=10, dy=0, unit="mm"), 1)
    assert [error["code"] for error in revision.check(doc, move)] == ["MOVE_NOT_SUPPORTED"]


def test_entity_reading(plan):
    ref, handles = plan
    response = client.get("/dwg/entity", params={**ref.params(), "handle": handles["mtext"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["type"] == "MTEXT" and body["layer"] == "A-TEXT"
    assert body["plain_text"] == "SALA PISO MADERA"
    assert body["units"]["name"] == "mm" and body["format"] == "DXF"
    missing = client.get("/dwg/entity", params={**ref.params(), "handle": "FFFFF"})
    assert missing.status_code == 404 and missing.json()["code"] == "ENTITY_NOT_FOUND"
    bad = client.get("/dwg/entity", params={**ref.params(), "handle": "zz"})
    assert bad.status_code == 400


def test_original_is_never_written(plan):
    ref, handles = plan
    before = ref.path.read_bytes()
    assert preview(client, ref, op("dwg.set_text", handles["text"], text="OTRO"))["ok"] is True
    assert ref.path.read_bytes() == before


# --- The Autodesk samples -----------------------------------------------------------------------------------------

def _sample(name: str) -> Path:
    folder = os.environ.get("DWG_SAMPLES")
    path = Path(folder) / name if folder else None
    if path is None or not path.is_file():
        if os.environ.get("REQUIRE_FIXTURES") == "1":
            pytest.fail(f"REQUIRE_FIXTURES=1 and DWG_SAMPLES has no {name}")
        pytest.skip("DWG_SAMPLES is not set: point it to docs/mvp/modelos-nuevos-26-11/dwg")
    return path


def _first(originals, name: str, kinds: tuple):
    ref = originals.link(_sample(name))
    doc = ezdxf.readfile(str(revision.base_dxf(ref.path, ref.sha256)))
    entity = next(e for e in doc.modelspace() if e.dxftype() in kinds)
    return ref, entity


@pytest.mark.parametrize("name", SAMPLES)
def test_every_sample_converts_and_reads_back_in_the_viewer(originals, name):
    ref = originals.link(_sample(name))
    source = revision.base_dxf(ref.path, ref.sha256)
    read = revision.viewer_read(source)
    assert sum(read["types"].values()) > 0
    assert ezdxf.readfile(str(source)).modelspace()


def test_sample_text_change(originals):
    ref, entity = _first(originals, SAMPLES[0], ("MTEXT",))
    report = preview(client, ref, op("dwg.set_text", entity.dxf.handle, text="REVISADO OBRA"))
    assert report["ok"] is True, report["errors"]
    assert report["base"]["schema"] == "DWG"
    doc = _revision(build_revision(client, ref, [op("dwg.set_text", entity.dxf.handle, text="REVISADO OBRA")], report["artifact"]["id"]))
    assert doc.entitydb[entity.dxf.handle].text == "REVISADO OBRA"


def test_sample_move_and_note(originals):
    ref, entity = _first(originals, SAMPLES[2], ("INSERT",))
    operations = [op("dwg.move", entity.dxf.handle, 1, dx=500, dy=0, unit="mm"),
                  op("dwg.add_note", entity.dxf.handle, 2, text="Reubicar según obra")]
    report = preview(client, ref, *operations)
    assert report["ok"] is True, report["errors"]
    assert {layer["layer"]: layer["status"] for layer in report["validation"]["layers"]} == {1: "PASS", 2: "PASS", 6: "PASS"}
    moved = report["operations"][0]
    assert abs(moved["after"]["position"][0] - moved["before"]["position"][0] - 0.5) < 1e-6  # metres


def test_sample_dimension_override(originals):
    ref, entity = _first(originals, SAMPLES[3], ("DIMENSION",))
    report = preview(client, ref, op("dwg.set_text", entity.dxf.handle, text="<> VERIFICAR"))
    assert report["ok"] is True, report["errors"]
