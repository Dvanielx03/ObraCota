import {NotesContext,localNotes} from "./notes-source";
import {useContext,useEffect,useMemo,useState} from "react";
import type {ElementInfo} from "@/viewer/domain/viewer.port";

export function ReviewNotes({version,selected,elements,locate,onSaved}:{onSaved:()=>void;version:string;selected:ElementInfo|null;elements:ElementInfo[];locate:(id:string)=>void}){
  const stored=useContext(NotesContext);
  const local=useMemo(()=>localNotes(version),[version]);
  const source=stored || local;
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [legacy,setLegacy]=useState<Record<string,string>>({});
  const [draft,setDraft]=useState(""),[message,setMessage]=useState("");
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[attempt,retry]=useState(0);
  useEffect(()=>{
    let active=true;
    async function read(){
      try {
        const saved=await source.load();
        if(!active)return;
        setNotes(saved);setLoaded(true);setMessage("");
        if(stored) {const old=await local.load().catch(()=>({}));if(active)setLegacy(old);}
      }catch{if(active){setLoaded(false);setMessage("No se pudieron leer las observaciones.");}}
    }
    void read();
    if(!stored)window.addEventListener("storage",read);
    return ()=>{active=false;window.removeEventListener("storage",read);};
  },[source,stored,local,attempt]);
  useEffect(()=>{setDraft(selected?notes[selected.id]??"":"");},[notes,selected]);
  async function save(){
    if(!selected || !loaded)return;
    const value=draft.trim(),next={...notes};
    setBusy(true);
    try {
      await source.save(selected.id,value);
      if(value)next[selected.id]=value;else delete next[selected.id];
      setNotes(next);if(value)onSaved();
      setMessage(value?(stored?"Observación guardada en esta versión.":"Observación guardada en este navegador."):"Observación eliminada.");
    }catch{setMessage("No se pudo guardar la observación. Inténtalo de nuevo.");}
    finally{setBusy(false);}
  }
  const pending=Object.entries(legacy).filter(([key])=>!Object.prototype.hasOwnProperty.call(notes,key));
  async function importNotes(){
    if(!stored)return;
    setBusy(true);
    try{
      for(const [key,text] of pending) await stored.save(key,text,true);
      setNotes(await stored.load());setMessage("Observaciones importadas.");
    }catch{setMessage("No se completó la importación. Puedes reintentarla.");}
    finally{setBusy(false);}
  }
  return <details className="review-notes"><summary>{stored?"Observaciones de la versión":"Observaciones locales"} ({Object.keys(notes).length})</summary>
    {!loaded && message && <button onClick={()=>retry(v=>v+1)}>Reintentar lectura</button>}
    {loaded && pending.length>0 && <button disabled={busy} onClick={importNotes}>Importar notas de este navegador ({pending.length})</button>}
    {selected && <label>Observación sobre la selección<textarea value={draft} disabled={!loaded||busy} maxLength={stored?4000:undefined} onChange={e=>{setDraft(e.target.value);setMessage("");}}/>
      </label>}
    {selected && <button disabled={!loaded||busy||draft.trim()===(notes[selected.id]??"")} onClick={save}>{!draft.trim() && notes[selected.id]?"Eliminar observación":"Guardar observación"}</button>}
    <p role="status">{message}</p>
    {Object.entries(notes).map(([id,text])=>{
      const item=elements.find(el=>el.id===id);
      return <button key={id} disabled={!item} onClick={()=>locate(id)}>{item?.name??"Vínculo perdido"} · {text}</button>;
    })}
  </details>;
}
