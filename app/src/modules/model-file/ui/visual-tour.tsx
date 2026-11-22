import {useCallback,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";

type Phase="select"|"note"|"review";
export type Stop={node:HTMLElement;title:string;action:string;keepVisible?:HTMLElement};
function target(phase:Phase,hasSelection:boolean):Stop|null{
  const dialog=document.querySelector<HTMLDialogElement>(".delivery-review[open]");
  const find=(selector:string,title:string,action:string):Stop|null=>{
    const node=document.querySelector<HTMLElement>(selector);
    return node && node.getClientRects().length?{node,title,action}:null;
  };
  // REVISAR opens a panel over the bar; the report it prepares opens in a modal dialog.
  if(dialog){
    if(phase!=="review")return find(".delivery-review .review-heading button","Vuelve a la referencia","Cierra la revisión para continuar la práctica en el modelo.");
    const download=find(".delivery-review [data-tour=download]","Conserva el resultado","Comprueba las observaciones y descarga el informe con sus referencias.");
    if(download)return download;
  }
  const panel=document.querySelector<HTMLElement>(".review-popover:not([hidden])");
  if(panel){
    if(phase!=="review")return find(".review-popover .tool-popover-close","Vuelve a la referencia","Cierra la revisión para continuar la práctica en el modelo.");
    const input=panel.querySelector("textarea");
    if(input && !input.value.trim())return {node:input,title:"Define qué revisar",action:"Escribe un concepto presente en el plano, uno por línea."};
    return find(".review-popover [data-tour=prepare]","Prepara la revisión","Pulsa aquí para reunir la evidencia y tus observaciones.");
  }
  if(phase==="review")return find(".review-trigger","Reúne la evidencia","Abre la revisión de entrega para preparar el informe del archivo actual.");
  if(document.getElementById("explorer")?.hidden)return find(".scene-explorer","Abre el explorador","Despliega el panel para trabajar con los elementos del archivo.")
    ??find(".stagebar > .explorer-toggle","Abre el explorador","Despliega el panel para trabajar con los elementos del archivo.");
  if(phase==="select" || !hasSelection){
    if(document.getElementById("pane-reading")?.hidden)return find("#tab-reading","Abre Lectura","Vuelve al árbol para localizar la referencia.");
    const search=document.querySelector<HTMLInputElement>(".search input");
    const entry=find(".entry","Localiza la referencia","Elige este resultado u otro elemento que quieras revisar. Sus datos aparecerán en Propiedades.");
    if(entry && (search?.value.trim() || !document.querySelector(".drawing-info")))return entry;
    if(search && !search.value.trim())return {node:search,title:"Busca en el archivo",action:"Escribe una palabra del plano o el nombre de una pieza para encontrar su referencia."};
    return entry??find(".level","Explora el grupo","Abre la capa o el nivel para elegir uno de sus elementos.")??find(".search input","Ajusta la búsqueda","Prueba otra palabra del archivo para encontrar resultados.");
  }
  if(document.getElementById("pane-properties")?.hidden)return find("#tab-properties","Abre Propiedades","Revisa la pieza seleccionada y sus observaciones.");
  if(!document.querySelector(".review-notes"))return find(".guide-skip-note","Continúa con la entrega","Este archivo no permite guardar una nota local en este navegador.");
  if(!document.querySelector(".review-notes[open]"))return find(".review-notes summary","Abre las observaciones","Aquí se guardan las notas vinculadas a la referencia seleccionada.");
  const save=document.querySelector<HTMLButtonElement>(".review-notes > button");
  const field=document.querySelector<HTMLTextAreaElement>(".review-notes textarea");
  if(field && (!field.value.trim()||save?.disabled))return {node:field,title:"Anota qué revisarías",action:"Escribe o modifica una observación sobre esta pieza o detalle."};
  return find(".review-notes > button","Guarda tu observación","Pulsa para vincular la nota al elemento y a esta versión del archivo.");
}

type Frame={host:HTMLElement;stop:Stop;x:number;y:number;w:number;h:number;cx:number;cy:number;px:number;py:number};
export function VisualTour({phase,selected,paused,pause,back,restart,exit}:{phase:Phase;selected:boolean;paused:boolean;pause:()=>void;back:()=>void;restart:()=>void;exit:()=>void}){
  const resolve=useCallback(()=>target(phase,selected),[phase,selected]);
  return <GuidedPointer resolve={resolve} id="tour-instruction" label="Tutorial visual" paused={paused} pause={pause} back={phase!=="select"?back:undefined} restart={restart} exit={exit}/>;
}

export function GuidedPointer({resolve,id,label,paused,pause,back,restart,exit,completed=false}:{
  resolve:()=>Stop|null;id:string;label:string;paused:boolean;pause:()=>void;back?:()=>void;restart:()=>void;exit:()=>void;completed?:boolean;
}){
  const [frame,setFrame]=useState<Frame|null>(null);
  const card=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    let raf=0,previous:HTMLElement|null=null;
    const observer=new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    function measure(){
      const stop=resolve();
      if(!stop){setFrame(null);return;}
      if(previous!==stop.node){
        if(previous)observer.unobserve(previous);
        previous=stop.node;observer.observe(previous);
        if(!paused)previous.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
      }
      if(card.current)observer.observe(card.current);
      const r=stop.node.getBoundingClientRect(),vv=window.visualViewport;
      const host=document.querySelector<HTMLElement>(".delivery-review[open]")??document.body;
      const left=vv?.offsetLeft??0,top=vv?.offsetTop??0,right=left+(vv?.width??innerWidth);
      const bottom=top+(vv?.height??innerHeight);
      const w=card.current?.offsetWidth??Math.min(268,right-left-16),h=card.current?.offsetHeight??150;
      const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(v,max));
      const places=[[r.right+15,r.top],[r.left-w-15,r.top],[r.left,r.bottom+16],[r.left,r.top-h-16]];
      const preview=stop.keepVisible?.getBoundingClientRect();
      if(preview)places.push([r.left,preview.top-h-16]);
      const ranked=places.map(([x,y])=>{
        x=clamp(x,left+8,right-w-8);y=clamp(y,top+8,bottom-h-8);
        const area=(rect:DOMRect,padding=0)=>Math.max(0,Math.min(x+w,rect.right+padding)-Math.max(x,rect.left-padding))
          *Math.max(0,Math.min(y+h,rect.bottom+padding)-Math.max(y,rect.top-padding));
        return {x,y,targetOverlap:area(r,6),previewOverlap:preview?area(preview):0};
      }).sort((a,b)=>a.targetOverlap-b.targetOverlap || a.previewOverlap-b.previewOverlap);
      setFrame({host,stop,x:r.left,y:r.top,w:r.width,h:r.height,cx:ranked[0].x,cy:ranked[0].y,
        px:Math.round(clamp(r.left+r.width*.68,left,right-26)),py:Math.round(clamp(r.top+r.height*.62,top,bottom-32))});
    }
    function schedule(){cancelAnimationFrame(raf);raf=requestAnimationFrame(measure);}
    const mutations=new MutationObserver(records=>{
      if(records.some(record=>!(record.target as Element).closest?.("[data-visual-tour]")))schedule();
    });
    mutations.observe(document.querySelector("main")!,{subtree:true,childList:true,attributes:true,attributeFilter:["open","disabled","aria-disabled","aria-expanded","hidden","aria-pressed"]});
    document.addEventListener("input",schedule,true);document.addEventListener("scroll",schedule,true);
    // Popovers enter with a short scale animation: measure again once it settles, or the light keeps the in-between box.
    // The tour's own light and pointer animate too; those never change what is being pointed at.
    const settled=(event:Event)=>{if(!(event.target as Element).closest?.("[data-visual-tour]"))schedule();};
    document.addEventListener("animationend",settled,true);document.addEventListener("transitionend",settled,true);
    window.visualViewport?.addEventListener("resize",schedule);window.visualViewport?.addEventListener("scroll",schedule);
    measure();schedule();
    return ()=>{cancelAnimationFrame(raf);observer.disconnect();mutations.disconnect();document.removeEventListener("input",schedule,true);document.removeEventListener("scroll",schedule,true);
      document.removeEventListener("animationend",settled,true);document.removeEventListener("transitionend",settled,true);
      window.visualViewport?.removeEventListener("scroll",schedule);window.visualViewport?.removeEventListener("resize",schedule);};
  },[resolve,paused]);
  const active=frame?.stop.node;
  useLayoutEffect(()=>{
    if(!active || paused)return;
    const original=active.getAttribute("aria-describedby");
    active.setAttribute("aria-describedby",[original,id].filter(Boolean).join(" "));
    return ()=>{if(original)active.setAttribute("aria-describedby",original);else active.removeAttribute("aria-describedby");};
  },[active,paused,id]);
  if(!frame)return null;
  const {x,y,w,h,cx,cy,px,py,stop,host}=frame;
  return createPortal(<div data-visual-tour="">
    {!paused && !completed && <><div className="tour-light" aria-hidden="true" style={{left:x-3,top:y-3,width:w+6,height:h+6}}/>
      <svg className="tour-pointer" aria-hidden="true" style={{transform:`translate(${px}px,${py}px)`}} viewBox="0 0 26 32"><path d="M2 2 23 17 13 18 9 28Z" fill="#ffbe55" stroke="#17242c" strokeWidth="2"/></svg></>}
    <section ref={card} className="tour-card" style={{left:cx,top:cy}} aria-label={label}>
      <div id={id} aria-live="polite"><b>{paused?"Tutorial en pausa":stop.title}</b>{!paused && <p>{stop.action}</p>}</div>
      <div className="tour-controls">{!paused && back && <button onClick={back}>Atrás</button>}
        {!completed && <button onClick={pause}>{paused?"Reanudar":"Pausar"}</button>}<button onClick={restart}>Reiniciar</button><button onClick={exit}>{completed?"Finalizar":"Omitir"}</button></div>
    </section>
  </div>,host);
}
