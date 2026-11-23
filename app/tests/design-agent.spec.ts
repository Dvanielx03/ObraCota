import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {editButton,selectionPanel} from "./support/editar-prisma";
import {createProject,renderButton} from "./support/opciones-visuales";

/**
 * H4 · «Proponer cambio al modelo» (decisión D9): in EDITAR a piece is marked with the note «Cambiar FireRating a EI 60»
 * and the second button of the field sends the note and its GlobalId to the design agent. The framing of the door
 * leaves its wall in front, so the click marks the wall and page.route only swaps that GlobalId for the door's. The backend runs with
 * AGENT_PROVIDER=fake (the default): a scripted agent without AI reads the door, drafts ifc.set_property, previews it
 * with the real IFC engine and sends it for approval. The panel shows the steps; the card is READY with set_property,
 * created by the agent, and publishing still takes the owner's own click. No request leaves for googleapis.com.
 */
const door="1hOSvn6df7F8_7GcBWlS8Z";

test.use({viewport:{width:1366,height:768}});

test("Proponer cambio al modelo deja un borrador del agente listo para aprobar",async({page})=>{
  const ifc=process.env.DUPLEX_IFC;
  test.skip(!ifc,"Indica el IFC Duplex original con DUPLEX_IFC.");
  test.setTimeout(300_000);
  const outside:string[]=[];
  page.on("request",request=>{ if(/googleapis\.com/.test(request.url()))outside.push(request.url()); });
  const project=await createProject(page,"Agente de diseño");
  const base="/api/projects/"+project.id;
  try{
    const availability=await (await page.request.get(base+"/agent-runs",{headers:project.headers})).json();
    test.skip(availability.provider!=="fake","El backend debe correr con AGENT_PROVIDER=fake: esta prueba nunca llama a Gemini.");
    const uploaded=await page.request.post(base+"/uploads",{headers:{...project.headers,"Content-Type":"application/octet-stream"},
      params:{name:"Duplex_A.ifc"},data:readFileSync(ifc!)});
    expect(uploaded.status(),await uploaded.text()).toBe(201);
    const v1=(await uploaded.json()).id as string;

    // 1 · the door is the chosen piece; Editar takes it into its selection, frames it and marks its centre.
    await page.goto("/proyectos/"+project.id+"/visor/"+v1+"?element="+door);
    await expect(renderButton(page)).toBeVisible({timeout:120_000});
    await editButton(page).click();
    await expect(editButton(page)).toHaveAttribute("aria-pressed","true");
    await expect(selectionPanel(page).getByRole("listitem")).toHaveCount(1);
    await selectionPanel(page).getByRole("button",{name:"Encuadrar selección"}).click();
    await page.waitForTimeout(1500);
    // A point on the piece under the centre of the framing. Framing the door from the default direction leaves its wall
    // in front of it, so the click lands on the wall; the request is redirected to the door below (step 2).
    const layer=page.locator(".edit-layer");
    const canvas=(await page.locator(".view canvas").boundingBox())!;
    await page.mouse.click(canvas.x+canvas.width*.5,canvas.y+canvas.height*.5);
    await expect(layer.locator('[data-edit-mark][data-kind="point"]')).toHaveCount(1);
    const note=layer.getByRole("textbox",{name:"Describe el cambio de la marca 1"});
    await expect(note).toBeFocused();
    await note.fill("Cambiar FireRating a EI 60");

    // 2 · two buttons (D9): «Enviar edición» stays for images; «Proponer cambio al modelo» goes to the agent.
    await expect(layer.getByRole("button",{name:"Enviar edición"})).toBeVisible();
    const propose=layer.getByRole("button",{name:"Proponer cambio al modelo"});
    await expect(propose).not.toHaveAttribute("aria-disabled","true");
    await expect(propose).toHaveAttribute("title",/agente de prueba, sin costo/);
    // The body the button builds keeps the marked piece's GlobalId; only that GlobalId is swapped for the door's, so the
    // real backend and the real engine run the case of the roadmap (a door's FireRating).
    let original:{version:string;notes:{globalId:string|null;name:string|null;text:string}[]}|null=null;
    await page.route("**/api/projects/*/agent-runs",async route=>{
      if(route.request().method()!=="POST")return route.fallback();
      original=route.request().postDataJSON();
      const notes=original!.notes.map(note=>({...note,globalId:door,name:"M_Single-Flush:0762 x 2032mm:150173"}));
      return route.continue({postData:JSON.stringify({...original,notes})});
    });
    const sent=page.waitForRequest(request=>request.url().endsWith("/agent-runs") && request.method()==="POST");
    const answered=page.waitForResponse(response=>response.url().endsWith("/agent-runs") && response.request().method()==="POST",{timeout:240_000});
    await propose.click();
    await sent;
    expect(original!.version).toBe(v1);
    expect(original!.notes).toHaveLength(1);
    expect(original!.notes[0].text).toBe("Cambiar FireRating a EI 60");
    expect(original!.notes[0].globalId).toMatch(/^[0-9A-Za-z_$]{22}$/);
    const panel=page.getByRole("region",{name:"Propuesta del agente"});
    await expect(panel).toContainText("El agente está preparando el cambio");
    const run=await (await answered).json();
    expect(run.status,run.message).toBe("READY");
    expect(run.provider).toBe("fake");

    // 3 · the steps, then the card: READY, set_property, created by the agent.
    await expect(panel.getByRole("heading",{name:"Borrador listo para tu revisión"})).toBeVisible();
    const steps=panel.getByRole("list",{name:"Pasos del agente"}).getByRole("listitem");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toContainText("Leer la pieza marcada");
    await expect(steps.nth(1)).toContainText("Cambiar una propiedad en el borrador");
    await expect(steps.nth(2)).toContainText("Verificar la vista previa");
    await expect(steps.nth(3)).toContainText("Enviar a tu aprobación");
    await expect(panel).toContainText("Agente de prueba: sin IA y sin costo.");
    await panel.getByRole("link",{name:"Abrir la tarjeta del cambio"}).click();
    await expect(page).toHaveURL(new RegExp("/cambios#"+run.change));
    const card=page.locator(`article[id="${run.change}"]`);
    await expect(card.getByText("Lista para aprobar",{exact:true})).toBeVisible({timeout:60_000});
    await expect(card.getByRole("region",{name:"Receta"})).toContainText("FireRating");
    const change=await (await page.request.get(base+"/model-changes/"+run.change,{headers:project.headers})).json();
    expect(change).toMatchObject({status:"READY",origin:"AGENT",agentRun:run.id});
    expect(change.recipe.operations[0]).toMatchObject({op:"ifc.set_property",element:door,property:"FireRating",value:"EI 60"});
    expect(change.report.ok).toBe(true);

    // 4 · publishing is the owner's click: nothing was published by the agent.
    const versions=await (await page.request.get(base+"/files/"+(await uploaded.json()).fileId+"/versions",{headers:project.headers})).json();
    expect(versions).toHaveLength(1);
    await expect(card.getByRole("button",{name:"Aprobar y aplicar cambio"})).toBeEnabled();

    // 5 · the diary lists the four calls of the fake run; nothing went to Google.
    const diary=await (await page.request.get(base+"/agent-runs/"+run.id,{headers:project.headers})).json();
    expect(diary.map((step:{tool:string})=>step.tool)).toEqual(["get_element","draft_set_property","preview_change","submit_change"]);
    // …and the card shows the same trail after a reload, read from the diary.
    await page.reload();
    await card.getByText("Pasos del agente").click();
    const trail=card.getByRole("list",{name:"Pasos del agente"}).getByRole("listitem");
    await expect(trail).toHaveCount(4);
    await expect(trail.nth(3)).toContainText("Enviar a tu aprobación");
    expect(outside).toEqual([]);
  }finally{await project.remove();}
});
