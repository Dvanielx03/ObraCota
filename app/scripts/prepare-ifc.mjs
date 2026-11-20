import { copyFile, mkdir } from "node:fs/promises";
const destination = new URL("../public/ifc/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ["web-ifc-api.js", "web-ifc.wasm", "LICENSE.md"]) {
  await copyFile(new URL("../node_modules/web-ifc/" + name, import.meta.url), new URL(name, destination));
}
const dwg = new URL("../public/dwg/",import.meta.url);
await Promise.all(["dist/","wasm/"].map(dir=>mkdir(new URL(dir,dwg),{recursive:true})));
for (const [source,name] of [
  ["@mlightcad/libredwg-web/dist/libredwg-web.js","dist/reader.js"],
  ["@mlightcad/libredwg-web/wasm/libredwg-web.js","wasm/libredwg-web.js"],
  ["@mlightcad/libredwg-web/wasm/libredwg-web.wasm","wasm/libredwg-web.wasm"],
  ["three/build/three.core.js","math.js"]
]) await copyFile(new URL("../node_modules/"+source,import.meta.url),new URL(name,dwg));
