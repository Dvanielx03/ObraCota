import { expect, test } from "@playwright/test";

test("El ingreso y la landing enlazan los documentos del piloto", async ({ page }) => {
  await page.goto("/ingresar");
  await page.getByRole("link", { name: "privacidad de la cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Privacidad del piloto", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "obracota03@gmail.com" })).toHaveAttribute("href", "mailto:obracota03@gmail.com");
  await expect(page.getByText("Hasta 90 días.", { exact: false })).toBeVisible();
  await expect(page.getByText("Teléfono de contacto", { exact: false })).toContainText("[Por confirmar]");
  await page.getByRole("link", { name: "Términos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Términos de participación" })).toBeVisible();
  await page.goto(process.env.LANDING_URL ?? "http://localhost:3200");
  const footer = page.getByRole("navigation", { name: "Pie de página" });
  await expect(footer.getByRole("link", { name: "Privacidad", exact: true })).toHaveAttribute("href", "/privacidad");
  await expect(footer.getByRole("link", { name: "Términos del piloto" })).toHaveAttribute("href", /\/terminos$/);
  await footer.getByRole("link", { name: "Privacidad de cuentas" }).click();
  await expect(page.getByRole("heading", { name: "Privacidad del piloto", exact: true })).toBeVisible();
});
