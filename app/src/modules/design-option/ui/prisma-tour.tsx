import {useCallback} from "react";
import {GuidedPointer,type Stop} from "@/modules/model-file/ui/visual-tour";

export type MaskStep="edit-package"|"edit-import"|"edit-save";
export type PrismaStep="open"|"select"|"group"|"add"|"frame"|"preview"|"export"|MaskStep|"done";

function pointTo(selector:string,title:string,action:string,preview?:string):Stop|null{
  const node=document.querySelector<HTMLElement>(selector);
  if(!node?.getClientRects().length)return null;
  const closedDetails=node.closest("details:not([open])");
  if(closedDetails && node.closest("summary")?.parentElement!==closedDetails)return null;
  return {node,title,action,keepVisible:preview?document.querySelector<HTMLElement>(preview)??undefined:undefined};
}

function target(step:PrismaStep){
  if(step==="open"||document.getElementById("explorer")?.hidden)
    return pointTo('[data-prisma-tour="open"]',"Abre Prisma","Pulsa Prisma para abrir el asistente junto al modelo.");
  if(step==="select"||step==="add"){
    const result=pointTo('[data-prisma-tour="result"]',step==="select"?"Elige una pieza":"Añade esta pieza",
      "Pulsa un resultado para seleccionarlo en el modelo.");
    return result??pointTo('[data-prisma-tour="search"]',step==="select"?"Selecciona una pieza":"Busca otra pieza",
      "Escribe el nombre o la clase de una pieza. También puedes elegirla directamente en el modelo.");
  }
  if(step==="group")return pointTo('[data-prisma-tour="group"]',"Activa Agrupar","Así puedes añadir otra pieza y probar el mismo acabado en el conjunto.");
  if(step==="frame")return pointTo('[data-prisma-tour="frame"]',"Encuadra la selección","Pulsa aquí para acercar la vista al conjunto.");
  if(step==="preview")return pointTo('[data-prisma-tour="preview"]',"Prueba un acabado","Usa el color elegido para previsualizar el acabado en el visor. Esta práctica funciona sin Gemini.");
  if(step==="export")return pointTo('[data-prisma-tour="export"]',"Exporta la propuesta","Guarda esta vista como PNG para compartirla. Para seguir editando en Gemini, usa el paquete con máscara.");
  if(step==="edit-package"||step==="edit-import"||step==="edit-save"){
    const section=pointTo('[data-prisma-tour="edit-toggle"]',"Edita con una máscara","El ZIP incluye una vista limpia, una máscara y un prompt. Abre este apartado para continuar.");
    if(step==="edit-package"){
      return pointTo('[data-prisma-tour="edit-download"]',"Descarga el ZIP","Guarda el paquete con el encuadre y la máscara de la selección.",'[data-prisma-tour="edit-preview"]')
        ??pointTo('[data-prisma-tour="edit-recover"]:enabled',"Recupera el encuadre","Pulsa para centrar las piezas y buscar un ángulo donde se vean.")
        ??pointTo('[data-prisma-tour="edit-isolate"]:enabled',"Aísla la selección","Si el modelo sigue tapando piezas, puedes preparar el ZIP con una captura que incluya solo la selección.")
        ??pointTo('[data-prisma-tour="edit-prepare"]:enabled',"Prepara el paquete","Prisma comprobará que las piezas seleccionadas estén visibles antes de crear el ZIP.")
        ??pointTo('[data-prisma-tour="edit-request"]',"Describe el cambio","Escribe qué quieres editar, por ejemplo, cambiar el color de la cubierta seleccionada.")
        ??section;
    }
    if(step==="edit-import"){
      return pointTo('[data-prisma-tour="edit-import"]',"Importa el resultado de Gemini",
        "El paquete ya está cargado. En Gemini, usa las dos imágenes del ZIP y el prompt. Vuelve aquí y selecciona la imagen que Gemini te devuelva.")
        ??pointTo('[data-prisma-tour="edit-archive"]',"Recupera tu paquete","Pulsa Abrir ZIP de Prisma y busca ObraCota-edicion-Gemini.zip en Descargas. Luego podrás seleccionar la imagen de Gemini.")
        ??section;
    }
    return pointTo('[data-prisma-tour="edit-save"]',"Guarda el PNG protegido",
      "Prisma conserva la vista original fuera de la máscara. Revisa el resultado y pulsa para descargarlo.")
      ??pointTo('[data-prisma-tour="edit-import"]',"Carga una imagen compatible","Usa el mismo encuadre que enviaste a Gemini.")
      ??section;
  }
  return pointTo('[data-prisma-tour="help"]',"Guía de Prisma completada",
    "Ya puedes compartir una vista y editar una selección con Gemini usando el paquete y la máscara.");
}

export function PrismaTour({step,paused,onPause,onRestart,onExit}:{
  step:PrismaStep;paused:boolean;onPause:()=>void;onRestart:()=>void;onExit:()=>void;
}){
  const resolve=useCallback(()=>target(step),[step]);
  return <GuidedPointer resolve={resolve} id="prisma-instruction" label="Guía visual de Prisma" paused={paused}
    pause={onPause} restart={onRestart} exit={onExit} completed={step==="done"}/>;
}
