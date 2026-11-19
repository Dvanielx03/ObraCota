import { defineConfig, devices } from "@playwright/test";

// Las pruebas corren contra la compilación de producción en un puerto propio,
// con el Microsoft Edge instalado en el equipo (no se descargan navegadores).
const PUERTO = 3100;
// Con SITIO_EN_MARCHA=http://localhost:3002 se prueba un servidor ya abierto, sin compilar.
const EN_MARCHA = process.env.SITIO_EN_MARCHA;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  use: {
    baseURL: EN_MARCHA ?? `http://localhost:${PUERTO}`,
    channel: "msedge",
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [
    { name: "escritorio", use: { viewport: { width: 1440, height: 900 } } },
    { name: "movil", use: { ...devices["Pixel 7"], channel: "msedge" } },
  ],
  webServer: EN_MARCHA ? undefined : {
    command: `npm run build && npm run start -- -p ${PUERTO}`,
    url: `http://localhost:${PUERTO}`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
