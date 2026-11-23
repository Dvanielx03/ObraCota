import {expect,test} from "@playwright/test";
import {basename} from "node:path";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";

test("La información de piscina corresponde al texto, la cota y la capa seleccionados",async({page},info)=>{
  const file=process.env.TEST_DWG;
  test.skip(!file || basename(file).toLowerCase()!=="dwg_piscina_030824.dwg");
  await page.goto("/proyectos/restage/visor");
  await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(file!);
  await expect(page.locator(".project")).toHaveText(basename(file!),{timeout:90000});
  async function select(query:string){
    await page.getByRole("tab",{name:"Lectura"}).click();
    await page.getByRole("searchbox").fill(query);
    await page.locator(".entry").first().click();
    await page.getByRole("tab",{name:"Propiedades"}).click();
  }
  const region=page.getByRole("region",{name:"Información del plano"});
  await select("2c81e");
  await expect(page.locator(".inspector strong")).toHaveText("Rebose");
  await expect(region).toContainText("Inserción del texto (m)");
  await expect(region.locator("dd").first()).toContainText(/X -?[\d,]+ · Y -?[\d,]+/);
  await select("2BD4A");
  await expect(region).toContainText("Puntos de la cota (m)");
  const endpoints=await region.locator("dd").first().innerText();
  const values=Array.from(endpoints.matchAll(/[XY] (-?[\d,]+)/g),m=>Number(m[1].replace(",",".")));
  expect(values).toHaveLength(4);
  const length=Number((await page.getByText("Medida geométrica",{exact:true}).locator("+ dd").innerText()).split(" ")[0].replace(",",".")); 
  expect(length).toBeGreaterThan(0);
  expect(length).toBeCloseTo(Math.hypot(values[2]-values[0],values[3]-values[1]),4);
  await page.screenshot({path:info.outputPath("cota-piscina.png")});
  await select("Trazos · Dibujo");
  await expect(region).toContainText("Entidades por tipo CAD");
  const counts=await region.locator("dd").first().locator("div").allTextContents();
  const sum=counts.reduce((n,row)=>n+Number(row.split(" · ")[1]),0);
  expect(sum).toBe(Number(await page.getByText("Entidades",{exact:true}).locator("+ dd").innerText()));
  await expect(region).not.toContainText("Puntos de la cota");
});

test("Un PDF vinculado a Rebose permanece en la selección correcta del DWG",async({page,context})=>{
  const file=process.env.TEST_DWG;
  test.skip(!file || basename(file).toLowerCase()!=="dwg_piscina_030824.dwg");
  test.setTimeout(150000);
  const login=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(login.status()).toBe(201);
  const headers={Authorization:"Bearer "+(await login.json()).accessToken};
  const result=await page.request.post("/api/projects",{headers,data:{name:"Prueba de lectura DWG"}});
  const id=(await result.json()).id;
  try{
    await page.goto("/proyectos/"+id+"/archivos");
    await page.getByTestId("model-upload").setInputFiles(file!);
    await page.getByRole("button",{name:"Guardar versión"}).click();
    await page.getByRole("link",{name:"Abrir versión 1 en el visor"}).click();
    async function select(handle:string){
      await page.getByRole("tab",{name:"Lectura"}).click();
      await page.getByRole("searchbox").fill(handle);
      await page.locator(".entry").first().click();
      await page.getByRole("tab",{name:"Propiedades"}).click();
      await page.getByText("Documentos de la selección",{exact:true}).click();
    }
    await select("2C81E");
    await expect(page.getByText("La selección no tiene un PDF vinculado en esta versión.")).toBeVisible();
    const fixture=await context.newPage();
    await fixture.setContent("<p>Control de prueba. Transcripción de la etiqueta 2C81E: Rebose.</p>");
    const buffer=await fixture.pdf(); await fixture.close();
    await page.getByLabel("Vincular PDF a esta selección").setInputFiles({name:"Transcripcion-ensayo.pdf",mimeType:"application/pdf",buffer});
    const cite=page.getByRole("button",{name:"Transcripcion-ensayo.pdf · pág. 1",exact:true});
    await expect(cite).toBeVisible();
    await select("2BD4A");
    await expect(page.getByText("La selección no tiene un PDF vinculado en esta versión.")).toBeVisible();
    await expect(cite).toHaveCount(0);
    await page.reload();await select("2C81E");await expect(cite).toBeVisible();
  }finally{await page.request.delete("/api/projects/"+id,{headers});}
});

test("Consulta y descarga evidencia verificable del plano de piscina",async({page},info)=>{
  const file=process.env.TEST_DWG;
  test.skip(!file || basename(file).toLowerCase()!=="dwg_piscina_030824.dwg");
  await page.goto("/proyectos/restage/visor");
  await expect(page.getByRole("button",{name:"Revisar entrega"})).toBeVisible();
  await page.locator("header input").setInputFiles(file!);
  await expect(page.locator(".project")).toHaveText(basename(file!),{timeout:90_000});
  const query=page.getByRole("searchbox",{name:"Buscar elemento"});
  const kind=page.getByRole("combobox",{name:"Tipo de consulta del plano"});
  const download=page.getByRole("button",{name:"Descargar ficha"});
  await kind.selectOption("text");
  await query.fill("2c81e");
  const hit=page.getByRole("button",{name:/Rebose.*Handle 2C81E/i});
  await hit.click();
  await expect(hit).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".note-marker")).toBeVisible();

  await kind.selectOption("dimension");
  await expect(page.getByText("Ningún elemento coincide.")).toBeVisible();
  await expect(download).toBeDisabled();
  await query.fill("2BD4A");
  const dimension=page.getByRole("button",{name:/Handle 2BD4A · 16,169499 m/});
  await expect(page.getByText("1 coincidencia",{exact:true})).toBeVisible();
  await dimension.click();
  await expect(dimension).toHaveAttribute("aria-pressed","true");
  const received=page.waitForEvent("download");
  await download.click();
  const content=await readFile((await (await received).path())!,"utf8");
  expect(content).toContain("DWG_PISCINA_030824.dwg");
  expect(content).toContain("Handle 2BD4A · 16,169499 m");
  expect(content).toContain("Puntos");
  expect(content).not.toContain("Handle 2C81E");
  await page.screenshot({path:info.outputPath("consulta-cota.png")});

  await kind.selectOption("layer");
  await query.fill("cotas - general");
  await expect(page.getByRole("button",{name:/^Cotas - General\s+\d+$/})).toBeVisible();
  await expect(download).toBeEnabled();
});
