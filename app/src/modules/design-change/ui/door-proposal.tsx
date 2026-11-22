import {useState,type FormEvent} from "react";
import Link from "next/link";
import {authenticated} from "@/core/http/http-client";
import {DoorReview,endpoints,type Change,type Door,type Price,type Review} from "./door-review";
import {LoadingStatus} from "@/shared/ui/loading";

function uploadImage(file:File):Promise<string>{
  return new Promise((resolve,reject)=>{
    if(file.size>4_000_000){reject(new Error("El PNG debe pesar menos de 4 MB."));return;}
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("No se pudo leer el PNG."));
    reader.readAsDataURL(file);
  });
}

export function DoorProposal({project,version,element,capture}:{project:string;version:string;element:string;capture:()=>string}){
  const base=endpoints(project);
  const [door,setDoor]=useState<Door>(),[type,select]=useState(""),[description,setDescription]=useState("");
  const [picture,setPicture]=useState(""),[review,setReview]=useState<Review>(),[created,setCreated]=useState<Change>();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const params=new URLSearchParams({version,element});
  const chosen=door?.options.find(option=>option.id===type);
  async function perform(work:()=>Promise<void>){
    setBusy(true);setError("");
    try{await work();}catch(e){setError(e instanceof Error?e.message:"No se pudo completar la solicitud.");}
    finally{setBusy(false);}
  }
  async function start(){
    const result=await authenticated<Door>(base+"/door?"+params);
    setDoor(result);select(result.options.find(option=>option.compatible)?.id??"");
  }
  async function saveSettings(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    await perform(async()=>{
      const prices:Price[]=[];
      for(const [prefix,typeId] of [["actual",door?.typeId],["propuesto",type]] as const){
        if(typeId && String(data.get(prefix+"Precio")).trim())prices.push({
          typeId,amount:Number(data.get(prefix+"Precio")),source:String(data.get(prefix+"Fuente")),date:String(data.get(prefix+"Fecha")),
        });
      }
      const minimum=String(data.get("minimum")).trim();
      await authenticated(base+"/pricing?"+new URLSearchParams({version}),{method:"PUT",body:JSON.stringify({minimum:minimum?Number(minimum)/1000:null,prices})});
      if(type)await inspect();
    });
  }
  async function inspect(){setReview(await authenticated<Review>(base+"/review?"+new URLSearchParams({version,element,typeId:type})));}
  async function register(){
    const result=await authenticated<Change>(base,{method:"POST",body:JSON.stringify({version,element,typeId:type,description,picture:picture.split(",")[1]})});
    setCreated(result);
  }

  return <section className="door-proposal" aria-label="Cambiar tipo de puerta"><h3>Cambiar tipo de puerta</h3>
    {!door && <button disabled={busy} onClick={()=>void perform(start)}>Proponer cambio IFC</button>}
    {door && !door.options.length && <p>El archivo carece de tipos alternativos con representación y medidas verificables.</p>}
    {door && !!door.options.length && !created && <>
      <label>Describe el cambio<textarea value={description} maxLength={2000} onChange={e=>setDescription(e.target.value)}/></label>
      <label>Tipo IFC propuesto<select value={type} onChange={e=>{select(e.target.value);setReview(undefined);}}>
        <option value="">Elegir tipo</option>{door.options.map(option=><option key={option.id} value={option.id}>
          {option.name} · {option.id.slice(-6)}{option.compatible?" · Compatible":""}
        </option>)}</select></label>
      {!chosen?.compatible&&chosen && <p>La aplicación automática requiere un tipo compatible con las medidas y el hueco actuales. Puedes registrar esta propuesta para revisión.</p>}
      <details><summary>Elegir propuesta visual</summary>
        <button onClick={()=>setPicture(capture())}>Usar la vista actual como propuesta</button>
        <label>Elegir PNG de propuesta<input type="file" accept=".png,image/png" onChange={e=>{
          const file=e.target.files?.[0];
          if(file)void perform(async()=>setPicture(await uploadImage(file)));
        }}/></label>
        {picture && <figure><img src={picture} alt="Propuesta visual elegida"/><figcaption>Referencia visual</figcaption></figure>}
      </details>
      {type && <details key={type}><summary>Ingresar precio y ancho mínimo</summary>
        <form onSubmit={saveSettings}>
          <label>Ancho nominal mínimo de proyecto (mm)<input type="number" name="minimum" min="1" step="1"/></label>
          {([["actual","Tipo actual"],["propuesto","Tipo propuesto"]] as const).map(([prefix,label])=><fieldset key={prefix}><legend>{label}</legend>
            <label>Precio COP<input type="number" name={prefix+"Precio"} min="0" step=".01"/></label>
            <label>Fuente<input name={prefix+"Fuente"} maxLength={300}/></label><label>Fecha<input name={prefix+"Fecha"} type="date"/></label>
          </fieldset>)}
          <button disabled={busy}>Guardar datos de revisión</button>
        </form>
      </details>}
      <button disabled={busy||!type} onClick={()=>void perform(inspect)}>Revisar costo y avisos</button>
      {review && <><DoorReview review={review} project={project} version={version}/>
        <button disabled={busy||!description.trim()} onClick={()=>void perform(register)}>Registrar propuesta IFC</button></>}
    </>}
    {created && <p role="status">Propuesta registrada. <Link href={"/proyectos/"+project+"/cambios#"+created.id}>Revisar y decidir si aplicar</Link></p>}
    {busy && <LoadingStatus>Consultando el cambio…</LoadingStatus>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
