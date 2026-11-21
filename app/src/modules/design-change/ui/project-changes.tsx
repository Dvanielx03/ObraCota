"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {PanelView} from "@/shared/ui/panel-view";
import {authenticated,authenticatedResponse} from "@/core/http/http-client";
import {DoorEstimate,DoorReview,endpoints,type Change} from "./door-review";

function Picture({path}:{path:string}){
  const [url,setUrl]=useState(""),[error,setError]=useState(false);
  useEffect(()=>{
    const control=new AbortController();
    let objectUrl="";
    authenticatedResponse(path,{signal:control.signal}).then(r=>r.blob()).then(blob=>{
      if(!control.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}
    }).catch(()=>{if(!control.signal.aborted)setError(true);});
    return ()=>{control.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path]);
  return url?<img src={url} width={320} style={{maxWidth:"100%",height:"auto"}} alt="Propuesta visual elegida"/>:<p>{error?"No se pudo abrir la propuesta.":"Cargando propuesta…"}</p>;
}
export function ProjectChanges({project,budget=false}:{project:string;budget?:boolean}){
  const [rows,setRows]=useState<Change[]>(),[working,setWorking]=useState<string>(),[error,setError]=useState("");
  const base=endpoints(project),prefix="/proyectos/"+project;
  useEffect(()=>{
    const control=new AbortController();
    authenticated<Change[]>(base,{signal:control.signal}).then(setRows).catch(e=>{if(!control.signal.aborted)setError(e.message);});
    return ()=>control.abort();
  },[base]);
  async function decide(change:Change,decision:"apply"|"restore"){
    setWorking(change.id);setError("");
    try {
      const result=await authenticated<Change>(base+"/"+change.id+"/"+decision,{method:"POST"});
      setRows(previous=>previous?.map(row=>row.id===result.id?result:row));
    }catch(e){setError(e instanceof Error?e.message:"No se pudo publicar la revisión.");}
    finally{setWorking(undefined);}
  }
  return <PanelView title={budget?"Presupuesto":"Cambios de diseño"} project={false}>
    {error && <p role="alert">{error}</p>}
    {!rows && !error && <p role="status">Cargando revisiones…</p>}
    {rows?.length===0 && <p>Selecciona una puerta de una <Link href={prefix+"/archivos"}>versión IFC guardada</Link> para registrar una propuesta.</p>}
    <div className="estimate-sheet">{rows?.map(change=><article id={change.id} key={change.id}>
      <h2>{change.description}</h2><p>{change.review.door.name}</p>
      {budget?<DoorEstimate review={change.review}/>:<>
        {change.picture && <figure><Picture path={base+"/"+change.id+"/picture"}/><figcaption>Referencia visual</figcaption></figure>}
        <DoorReview review={change.review} project={project} version={change.version}/>
        {change.applied ? <p role="status">Cambio aplicado. <Link href={prefix+"/visor/"+change.applied+"?element="+encodeURIComponent(change.review.door.element)+"&anterior="+change.version}>Abrir nueva versión</Link></p>:
          <button className="panel-action" disabled={!!working || !change.review.proposal.compatible} onClick={()=>void decide(change,"apply")}>Aprobar y aplicar cambio</button>}
        {change.applied && !change.restored && <button className="panel-action restore-action" disabled={!!working} onClick={()=>void decide(change,"restore")}>Crear revisión de restauración</button>}
        {change.restored && <p><Link href={prefix+"/visor/"+change.restored}>Abrir revisión restaurada</Link></p>}
        {working===change.id && <p role="status">Comprobando y guardando la revisión IFC…</p>}
      </>}
    </article>)}</div>
  </PanelView>;
}
