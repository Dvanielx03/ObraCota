"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {useSession} from "@/core/auth/use-session";
import {PanelView} from "@/shared/ui/panel-view";
import {BusyButton,LoadingStatus} from "@/shared/ui/loading";
import {createProject,listProjects} from "@/modules/project/application/manage-projects";
import {projectHttpRepository} from "@/modules/project/infrastructure/project-http-repository";
import type {OwnedProject} from "@/modules/project/domain/owned-project";

function ProjectPicker(){
  const router=useRouter();
  const [projects,setProjects]=useState<OwnedProject[]>(),[error,setError]=useState(""),[attempt,retry]=useState(0);
  const [name,setName]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{
    let active=true;
    listProjects(projectHttpRepository).then(rows=>{if(active)setProjects(rows);})
      .catch(()=>{if(active)setError("No se pudieron cargar los proyectos.");});
    return ()=>{active=false;};
  },[attempt]);
  if(!projects)return error?<p role="alert">{error} <button onClick={()=>{setError("");retry(attempt+1);}}>Reintentar</button></p>:<LoadingStatus>Buscando tus proyectos…</LoadingStatus>;
  if(projects.length)return <section><h2>Abre el asistente de tu proyecto</h2><ul>{projects.map(p=>
    <li key={p.id}><Link href={"/proyectos/"+p.id+"/asistente"}>{p.name}</Link></li>)}</ul></section>;
  return <form className="account-form" onSubmit={async e=>{
    e.preventDefault();setSaving(true);setError("");
    try{const p=await createProject(projectHttpRepository,name.trim());router.push("/proyectos/"+p.id+"/asistente");}
    catch{setError("No se pudo crear el proyecto.");setSaving(false);}
  }}><label>Nombre del proyecto<input value={name} onChange={e=>setName(e.target.value)} required maxLength={120}/></label>
    <BusyButton className="panel-action" busy={saving} busyLabel="Creando el proyecto…" spinnerSize={14} disabled={!name.trim()}>Crear proyecto y abrir asistente</BusyButton>{error && <p role="alert">{error}</p>}</form>;
}
export function ProjectAssistant(){
  const {session,failed,retry}=useSession();
  return <PanelView title="Asistente"><section><h2>Consulta las fichas de tu proyecto</h2>
    <p>ReStage es el proyecto de demostración. En tu proyecto puedes preguntar por una ficha y abrir la página que respalda la respuesta.</p>
    <p><Link className="panel-action" href="/proyectos/restage/visor?panel=asistente">Probar Editar en ReStage</Link></p>
    {session?<ProjectPicker key={session.email}/>:session===null?<Link className="panel-action" href="/ingresar?desde=asistente">Iniciar sesión para usar el asistente</Link>:
      failed?<button onClick={retry}>Reintentar conexión</button>:<LoadingStatus>Consultando sesión…</LoadingStatus>}</section></PanelView>;
}
