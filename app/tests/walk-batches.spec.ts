import { expect, test } from "@playwright/test";
import * as T from "three";
import { batchWalkGeometry } from "../src/viewer/infrastructure/walk-batches";
import { expectWalkable, findFloor } from "./walk-support";

test("El recorrido agrupa mallas opacas sin alterar las fuentes", () => {
  const root = new T.Group();
  root.position.set(2, 1, 3);
  const geometry = new T.BoxGeometry(1, 1, 1);
  geometry.clearGroups();
  const opaque = new T.MeshStandardMaterial({color: 0x85705d});
  const glass = new T.MeshStandardMaterial({transparent: true, opacity: .3});
  const parts = Array.from({length: 130}, (_, index) => {
    const part = new T.Mesh(geometry.clone(), opaque);
    part.position.x = 1 + index / 100;
    root.add(part);
    return part;
  });
  const pane = new T.Mesh(geometry, glass), hidden = new T.Mesh(geometry, opaque);
  parts[0].scale.x = -1;
  hidden.visible = false;
  root.add(pane, hidden);
  const sourceGeometries = parts.map(part => part.geometry);
  const original = new T.Box3();
  root.updateWorldMatrix(true, true);
  parts.forEach(part => original.expandByObject(part));
  const batches = batchWalkGeometry(root);
  expect(batches?.meshCount).toBe(parts.length);
  expect(batches?.group.children).toHaveLength(1);
  const batched = batches!.group.children[0] as T.Mesh;
  expect(batched.material).toBe(opaque);
  const originalIndex = geometry.index!;
  const batchedIndex = batched.geometry.index!;
  expect([batchedIndex.getX(0), batchedIndex.getX(1), batchedIndex.getX(2)])
    .toEqual([originalIndex.getX(0), originalIndex.getX(2), originalIndex.getX(1)]);
  const area = new T.Box3().setFromObject(batched);
  expect(area.min.distanceTo(original.min)).toBeLessThan(1e-5);
  expect(area.max.distanceTo(original.max)).toBeLessThan(1e-5);
  expect(parts.every((part, index) => !part.visible && part.geometry === sourceGeometries[index])).toBe(true);
  expect(pane.visible).toBe(true);
  let released = false;
  batched.geometry.addEventListener("dispose", () => { released = true; });
  batches!.dispose();
  expect(released).toBe(true);
  expect(parts.every(part => part.visible)).toBe(true);
  expect(hidden.visible).toBe(false);
  sourceGeometries.forEach(source => source.dispose());
  geometry.dispose();
  glass.dispose();
  opaque.dispose();
});

test("Las instancias del recorrido conservan la geometría original al salir", () => {
  const root = new T.Group();
  const geometry = new T.BoxGeometry(1, 1, 1);
  geometry.clearGroups();
  const material = new T.MeshStandardMaterial();
  const parts = Array.from({length: 130}, (_, index) => {
    const part = new T.Mesh(geometry, material);
    part.position.x = index / 100;
    root.add(part);
    return part;
  });
  const batches = batchWalkGeometry(root)!;
  expect(batches.group.children).toHaveLength(1);
  const instance = batches.group.children[0] as T.InstancedMesh;
  expect(instance).toBeInstanceOf(T.InstancedMesh);
  expect(instance.geometry).toBe(geometry);
  const matrix = new T.Matrix4();
  instance.getMatrixAt(17, matrix);
  expect(matrix.elements[12]).toBeCloseTo(.17);
  expect(parts.every(part => !part.visible)).toBe(true);
  let released = false;
  geometry.addEventListener("dispose", () => { released = true; });
  batches.dispose();
  expect(released).toBe(false);
  expect(parts.every(part => part.visible)).toBe(true);
  geometry.dispose();
  material.dispose();
});

test("El IFC ReStage se agrupa en el recorrido y vuelve al visor al salir", async ({page}) => {
  const source = process.env.RESTAGE_IFC;
  test.skip(!source, "Indica el IFC original con RESTAGE_IFC.");
  test.setTimeout(240_000);
  await page.setViewportSize({width: 1366, height: 768});
  await page.goto("/proyectos/restage/visor");
  await page.locator("header input").setInputFiles(source!);
  await expect(page.locator(".project")).toHaveText(/\.ifc$/i, {timeout: 180_000});
  await expectWalkable(page);
  await findFloor(page);
  const stats = await page.evaluate(() => {
    const entry = performance.getEntriesByName("obracota:walk-batches").at(-1) as PerformanceMeasure | undefined;
    return entry?.detail as {sources: number; batches: number} | undefined;
  });
  expect(stats?.sources).toBeGreaterThan(1000);
  expect(stats?.batches).toBeLessThan(stats!.sources / 10);
  await page.getByRole("button", {name: "Salir", exact: true}).click();
  await expect(page.getByRole("toolbar", {name: "Controles del recorrido"})).toHaveCount(0);
  await expectWalkable(page);
});
