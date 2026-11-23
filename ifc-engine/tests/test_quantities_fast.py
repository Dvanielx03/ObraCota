"""A change that leaves the geometry as it was (a material, a property) measures each element once, without
openings or booleans, and reuses that line for «after»: a heritage wall can take 25 s to mesh (Rame Tower)."""
from types import SimpleNamespace

from obracota_engine import quantities
from obracota_engine.build import geometry_free


def test_unchanged_elements_are_measured_once_and_fast(synthetic, monkeypatch):
    wall = next(e for e in synthetic.file.by_type("IfcWall"))
    calls = []
    real = quantities._shape
    monkeypatch.setattr(quantities, "_shape", lambda element, fast=False: calls.append(fast) or real(element, fast))

    found, _ = quantities.lines(synthetic.file, synthetic.file, [wall.GlobalId], unchanged=frozenset({wall.GlobalId}))

    assert calls == [True]
    before, after = found
    assert (before["phase"], after["phase"]) == ("before", "after")
    assert before["quantity"] == after["quantity"] and before["quantity"] > 0
    assert quantities.FAST_BASIS.strip("; ")[:20] in before["basis"]


def test_changed_elements_keep_the_exact_measure(synthetic, monkeypatch):
    wall = next(e for e in synthetic.file.by_type("IfcWall"))
    calls = []
    real = quantities._shape
    monkeypatch.setattr(quantities, "_shape", lambda element, fast=False: calls.append(fast) or real(element, fast))

    quantities.lines(synthetic.file, synthetic.file, [wall.GlobalId])

    assert calls == [False, False]


def test_only_geometry_free_operations_qualify():
    recipe = SimpleNamespace(operations=[SimpleNamespace(id="m", op="ifc.set_material"),
                                         SimpleNamespace(id="p", op="ifc.set_property"),
                                         SimpleNamespace(id="t", op="ifc.change_type")])
    owners = {"a": ["m"], "b": ["p", "m"], "c": ["t"], "d": ["m", "t"]}
    assert geometry_free(recipe, owners) == frozenset({"a", "b"})
