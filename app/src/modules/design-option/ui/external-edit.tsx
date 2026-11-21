import {useEffect,useRef,useState} from "react";
import type {ElementInfo,GroupCapture,GroupCaptureView,ViewerPort} from "@/viewer/domain/viewer.port";
import type {MaskStep} from "./prisma-tour";
import {archiveEditFiles,prepareEditFiles,protectEdit,readEditArchive,type EditFiles} from "./external-edit-files";
import styles from "./selection-assistant.module.css";

function download(url:string,name:string){
  const link=document.createElement("a");
  link.href=url;link.download=name;link.click();
}

export function ExternalEdit({pieces,viewer,onGuide,onPrepared,onImported,onSaved}:{
  pieces:ElementInfo[];viewer:ViewerPort;onGuide:(step:MaskStep)=>void;onPrepared:()=>void;onImported:()=>void;onSaved:()=>void;
}){
  const [request,setRequest]=useState("");
  const [files,setFiles]=useState<EditFiles>();
  const [archive,setArchive]=useState<Blob>();
  const [archiveUrl,setArchiveUrl]=useState("");
  const [recovery,setRecovery]=useState<"reframe"|"isolated">();
  const [capture,setCapture]=useState<GroupCapture>();
  const [preview,setPreview]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const archiveInput=useRef<HTMLInputElement>(null);
  const imageInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(!archive){setArchiveUrl("");return;}
    const url=URL.createObjectURL(archive);
    setArchiveUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[archive]);
  async function prepare(view:GroupCaptureView){
    setBusy(true);setError("");setRecovery(undefined);setArchive(undefined);setCapture(undefined);
    setNotice(view==="reframe"?"Buscando un ángulo visible…":"Preparando la vista y la máscara…");
    try{
      await new Promise<void>(resolve=>window.setTimeout(resolve,0));
      const frame=viewer.captureGroup(pieces.map(p=>p.id),"png",view);
      if(frame.missing){
        setNotice("");
        if(view==="current"){
          setRecovery("reframe");
          setError("Hay piezas fuera de vista. Prisma necesita ver una parte de cada pieza seleccionada.");
        }else if(view==="reframe"){
          setRecovery("isolated");
          setError("La selección sigue tapada. Puedes capturar solo las piezas seleccionadas en el ZIP.");
        }else setError("Las piezas siguen superpuestas al aislarlas. Selecciona menos piezas o cambia el ángulo y vuelve a preparar.");
        return;
      }
      const next=prepareEditFiles(frame,pieces,request);
      setArchive(archiveEditFiles(next));setFiles(next);setPreview("");setCapture(frame);
      setNotice(view==="isolated"?"ZIP listo · Solo incluye las piezas seleccionadas.":"ZIP listo · Revisa la vista y su máscara.");
    }catch(err){setNotice("");setError(err instanceof Error?err.message:"No se pudo preparar el paquete.");}
    finally{setBusy(false);}
  }
  async function open(file:File){
    setBusy(true);setError("");setNotice("");
    try{
      setFiles(await readEditArchive(file));setArchive(undefined);setRecovery(undefined);setCapture(undefined);setPreview("");setNotice("Paquete cargado. Ya puedes importar la imagen de Gemini.");
      onPrepared();
    }catch{setError("No se pudo abrir el paquete. Usa el ZIP original que descargaste de Prisma.");}
    finally{setBusy(false);}
  }
  async function apply(file:File){
    if(!files)return;
    if(/\.zip$/i.test(file.name)){
      setError("Para recuperar un ZIP, pulsa Abrir ZIP de Prisma. Aquí se carga la imagen que devuelve Gemini.");
      return;
    }
    setBusy(true);setError("");setNotice("");setPreview("");
    try{
      setPreview(await protectEdit(files,file));setNotice("Imagen preparada. Revisa el cambio en la selección y guarda el PNG.");
      onImported();
    }catch(err){setError(err instanceof Error?err.message:"No se pudo leer la imagen editada.");}
    finally{setBusy(false);}
  }
  return <details className={styles.maskEdit} data-working={busy}>
    <summary data-prisma-tour="edit-toggle">Editar en Gemini con máscara</summary>
    <p>Descarga la vista limpia, la máscara y el prompt. Las zonas blancas indican qué piezas se pueden editar.</p>
    <button onClick={()=>onGuide(preview?"edit-save":archiveUrl?"edit-package":files||!pieces.length?"edit-import":"edit-package")}>Guía de edición con máscara</button>
    <form onSubmit={event=>{event.preventDefault();void prepare("current");}}>
      <label>Cambio para Gemini<textarea data-prisma-tour="edit-request" required maxLength={2000} disabled={busy} placeholder="Ej. Cambia el material de la cubierta seleccionada a zinc oscuro." value={request} onChange={e=>{setRequest(e.target.value);setArchive(undefined);setRecovery(undefined);setCapture(undefined);setError("");setNotice("");}}/></label>
      {!pieces.length && <p>Selecciona al menos una pieza para descargar un paquete nuevo.</p>}
      <button data-prisma-tour="edit-prepare" disabled={busy||!pieces.length||!request.trim()}>Preparar paquete para Gemini</button>
    </form>
    {error && <div className={styles.captureCallout} role="alert"><p>{error}</p>
      {recovery && <button data-prisma-tour={recovery==="reframe"?"edit-recover":"edit-isolate"} disabled={!pieces.length||!request.trim()} onClick={()=>void prepare(recovery)}>
        {recovery==="reframe"?"Reencuadrar y preparar de nuevo":"Aislar y preparar el ZIP"}</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {archiveUrl && capture && <div className={styles.captureReview}>
      <div className={styles.captureImages} data-prisma-tour="edit-preview">
        <figure><img src={capture.image} alt="Vista original del paquete"/><figcaption>Vista original</figcaption></figure>
        <figure><img src={capture.mask} alt="Área editable de la selección"/><figcaption>Área editable</figcaption></figure>
      </div>
      <a className="panel-action" data-prisma-tour="edit-download" href={archiveUrl} download="ObraCota-edicion-Gemini.zip" onClick={onPrepared}>Descargar paquete para Gemini</a>
    </div>}
    <div className={styles.editPickers}>
      <div>
        <button type="button" data-prisma-tour="edit-archive" disabled={busy} onClick={()=>archiveInput.current?.click()}>Abrir ZIP de Prisma</button>
        <small>Recupera un paquete guardado en Descargas.</small>
        <input ref={archiveInput} hidden aria-label="Paquete ZIP de Prisma" type="file" accept=".zip,application/zip,application/x-zip-compressed" disabled={busy} onChange={e=>{
          const file=e.target.files?.[0];e.target.value="";if(file)void open(file);
        }}/>
      </div>
      {files && <div>
        <p>Extrae el ZIP. Adjunta en Gemini primero la vista original y luego la máscara. Pega el texto de <code>03-prompt-para-gemini.txt</code>.</p>
        <button type="button" data-prisma-tour="edit-import" disabled={busy} onClick={()=>imageInput.current?.click()}>Seleccionar imagen de Gemini</button>
        <small>Formatos de imagen: PNG, JPG y WebP.</small>
        <input ref={imageInput} hidden aria-label="Imagen editada de Gemini" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{
        const file=e.target.files?.[0];e.target.value="";if(file)void apply(file);
        }}/>
      </div>}
    </div>
    {preview && <><img src={preview} alt="Vista final con cambios limitados a la selección"/><button data-prisma-tour="edit-save" onClick={()=>{
      download(preview,"ObraCota-edicion-protegida.png");onSaved();
    }}>Guardar PNG protegido</button></>}
  </details>;
}
