import {expect,type APIRequestContext,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";

/** The Duplex door of H1 and the alternate type of the same size (model-change.spec.ts). */
export const DOOR="1hOSvn6df7F8_7GcBWlS8Z",ALTERNATE="2klOFZffH6WQFlV10uM1wF";
const slow={timeout:180_000};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test fixture
async function json(response:Awaited<ReturnType<APIRequestContext["get"]>>,status:number):Promise<any>{
  expect(response.status(),await response.text()).toBe(status);
  return response.json();
}

/**
 * A project with the Duplex as v1 and v2 published from a real model change (the door to its alternate type), all by
 * API against the real engine: draft, operation, preview, submit and apply. No AI is involved.
 */
export async function publishedRevision(page:Page,ifc:string,name:string){
  const auth=await page.request.post("/api/auth/register",{headers:{"X-ObraCota-Client":"web"},data:{email:randomUUID()+"@example.test",password:randomUUID()}});
  expect(auth.ok()).toBeTruthy();
  const headers={Authorization:"Bearer "+(await auth.json()).accessToken};
  const {id}=await json(await page.request.post("/api/projects",{headers,data:{name}}),201);
  const base="/api/projects/"+id;
  const v1=(await json(await page.request.post(base+"/uploads",{headers:{...headers,"Content-Type":"application/octet-stream"},
    params:{name:"Duplex_A.ifc"},data:readFileSync(ifc)}),201)).id as string;
  const change=(await json(await page.request.post(base+"/model-changes",{headers,data:{baseVersion:v1,description:"Puerta alternativa para comparar"}}),201)).id as string;
  await json(await page.request.post(base+"/model-changes/"+change+"/operations",{headers,...slow,data:{op:"ifc.change_type",element:DOOR,type_id:ALTERNATE}}),201);
  expect((await json(await page.request.post(base+"/model-changes/"+change+"/preview",{headers,...slow}),200)).report.ok).toBe(true);
  await json(await page.request.post(base+"/model-changes/"+change+"/submit",{headers,...slow,data:{}}),200);
  const applied=await json(await page.request.post(base+"/model-changes/"+change+"/apply",{headers,...slow}),200);
  expect(applied.status).toBe("APPLIED");
  return {id,base,headers,v1,v2:applied.appliedVersion as string,change};
}
