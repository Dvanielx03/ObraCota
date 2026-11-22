import {authenticated,authenticatedResponse} from "@/core/http/http-client";
import type {ModelChange,ModelChangeRepository} from "../domain/model-change";

const changes=(project:string)=>"projects/"+encodeURIComponent(project)+"/model-changes";
const one=(project:string,change:string)=>changes(project)+"/"+encodeURIComponent(change);
const post=(path:string,body?:unknown)=>authenticated<ModelChange>(path,{method:"POST",body:body===undefined?undefined:JSON.stringify(body)});

export const modelChangeRepository:ModelChangeRepository={
  list:(project,signal)=>authenticated<ModelChange[]>(changes(project),{signal}),
  get:(project,change,signal)=>authenticated<ModelChange>(one(project,change),{signal}),
  create:(project,baseVersion,description)=>post(changes(project),{baseVersion,description}),
  addOperation:(project,change,operation)=>post(one(project,change)+"/operations",operation),
  preview:(project,change)=>post(one(project,change)+"/preview"),
  submit:(project,change,summary)=>post(one(project,change)+"/submit",summary?{summary}:{}),
  discard:(project,change,reason)=>post(one(project,change)+"/discard",reason?{reason}:{}),
  apply:(project,change)=>post(one(project,change)+"/apply"),
  restore:(project,change)=>post(one(project,change)+"/restore"),
  /**
   * The verified IFC of the preview as a `File` named `<base>-propuesta.ifc`: the viewer picks its reader by the
   * extension (`model-source.ts`), so the name has to end in `.ifc`.
   */
  async openPreview(project,change,signal){
    const response=await authenticatedResponse(one(project,change.id)+"/preview",{signal});
    const blob=await response.blob();
    if(change.preview.size!==null && blob.size!==change.preview.size)throw new Error("La descarga de la vista previa está incompleta.");
    return new File([blob],change.baseName.replace(/\.ifc$/i,"")+"-propuesta.ifc",{type:"application/octet-stream"});
  },
};
