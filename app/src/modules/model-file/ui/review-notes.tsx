import {useEffect,useState} from "react";
import type {ElementInfo} from "@/viewer/domain/viewer.port";

export function ReviewNotes({version,selected,elements,locate,onSaved}:{onSaved:()=>void;version:string;selected:ElementInfo|null;elements:ElementInfo[];locate:(id:string)=>void}){
  const prefix="obracota.review.v1."+version+".";
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [draft,setDraft]=useState(""),[message,setMessage]=useState("");
  useEffect(()=>{
    function read(){
      try {
        const saved:Record<string,string>={};
        for(const key of Object.keys(localStorage)){
          if(key.startsWith(prefix))saved[key.slice(prefix.length)]=localStorage.getItem(key)??"";
        }
        setNotes(saved);
      }catch{setMessage("El navegador bloqueó el almacenamiento local.");}
    }
    read();window.addEventListener("storage",read);
    return ()=>window.removeEventListener("storage",read);
  },[prefix]);
  useEffect(()=>{setDraft(selected?notes[selected.id]??"":"");},[notes,selected]);
  function save(){
    if(!selected)return;
    const value=draft.trim(),next={...notes};
    try {
      if(value){localStorage.setItem(prefix+selected.id,value);next[selected.id]=value;}
      else {localStorage.removeItem(prefix+selected.id);delete next[selected.id];}
      setNotes(next);if(value)onSaved();setMessage(value?"Observación guardada en este navegador.":"Observación eliminada.");
    }catch{setMessage("No se pudo guardar en este navegador.");}
  }
  return <details className="review-notes"><summary>Observaciones locales ({Object.keys(notes).length})</summary>
    {selected && <label>Observación sobre la selección<textarea value={draft} onChange={e=>{setDraft(e.target.value);setMessage("");}}/>
      </label>}
    {selected && <button disabled={draft.trim()===(notes[selected.id]??"")} onClick={save}>{!draft.trim() && notes[selected.id]?"Eliminar observación":"Guardar observación"}</button>}
    <p role="status">{message}</p>
    {Object.entries(notes).map(([id,text])=>{
      const item=elements.find(el=>el.id===id);
      return <button key={id} disabled={!item} onClick={()=>locate(id)}>{item?.name??"Vínculo perdido"} · {text}</button>;
    })}
  </details>;
}
