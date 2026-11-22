import {strFromU8,strToU8,unzipSync,zipSync} from "three/addons/libs/fflate.module.js";
import type {ElementInfo,GroupCapture} from "@/viewer/domain/viewer.port";

const originalName="01-vista-original.png";
const maskName="02-mascara-seleccion.png";
const promptName="03-prompt-para-gemini.txt";
const maxBytes=20*1024*1024;
const png=(bytes:Uint8Array<ArrayBuffer>)=>new Blob([bytes],{type:"image/png"});
const decode=(uri:string)=>Uint8Array.from(atob(uri.split(",")[1]),character=>character.charCodeAt(0));

export interface EditFiles {
  original:Uint8Array<ArrayBuffer>;
  mask:Uint8Array<ArrayBuffer>;
  prompt:string;
}

export function prepareEditFiles(frame:GroupCapture,pieces:ElementInfo[],request:string):EditFiles{
  if(frame.missing)throw new Error("Hay piezas ocultas o fuera del encuadre. Gira la cámara o encuadra la selección y vuelve a preparar el paquete.");
  const references=pieces.map(piece=>"- "+piece.name+" · "+piece.level+" · ID "+(piece.guid||piece.id)).join("\n");
  const prompt=[
    "Edit image 1 ("+originalName+"). Image 2 ("+maskName+") is its pixel-aligned edit mask.",
    "White pixels are the only editable area. Preserve all black areas exactly, including any roof or surface outside the white mask. Use the mask as the authoritative target, regardless of the color or name of any object.",
    "Return an edited version of image 1 only. Preserve the original camera, projection, crop, aspect ratio and placement of objects. Target size: "+frame.width+" × "+frame.height+" px. Do not overlay the mask, text or annotations.",
    "Selected model references, for context:\n"+references,
    "Requested change (original wording):\n"+request.trim(),
  ].join("\n\n");
  return {original:decode(frame.image),mask:decode(frame.mask),prompt};
}

export function archiveEditFiles(files:EditFiles){
  return new Blob([new Uint8Array(zipSync({
    [originalName]:files.original,[maskName]:files.mask,[promptName]:strToU8(files.prompt),
  },{level:0}))],{type:"application/zip"});
}

export async function readEditArchive(file:File):Promise<EditFiles>{
  if(file.size>maxBytes)throw new Error("El paquete supera 20 MB.");
  const names=new Set([originalName,maskName,promptName]);
  const parts=unzipSync(new Uint8Array(await file.arrayBuffer()),{
    filter:entry=>entry.compression===0 && entry.size<=maxBytes && names.delete(entry.name),
  });
  if(names.size)throw new Error("Abre el ZIP original descargado desde Editar.");
  return {original:new Uint8Array(parts[originalName]),mask:new Uint8Array(parts[maskName]),prompt:strFromU8(parts[promptName])};
}

export async function protectEdit(files:EditFiles,edited:File):Promise<string>{
  if(edited.size>maxBytes)throw new Error("La imagen supera 20 MB.");
  const images:ImageBitmap[]=[];
  try{
    for(const source of [png(files.original),png(files.mask),edited])images.push(await createImageBitmap(source));
    const [original,mask,result]=images;
    const {width,height}=original;
    if(width>1280 || height>1280 || mask.width!==width || mask.height!==height)
      throw new Error("La máscara y la vista del paquete deben tener las mismas dimensiones.");
    if(Math.abs(result.width*height/(result.height*width)-1)>.01)
      throw new Error("La imagen tiene otro formato de encuadre. Pide a Gemini conservar la proporción de la vista original.");
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
    ctx.drawImage(mask,0,0);
    const coverage=ctx.getImageData(0,0,width,height).data;
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(result,0,0,width,height);
    const edit=ctx.getImageData(0,0,width,height).data;
    ctx.clearRect(0,0,width,height);
    ctx.drawImage(original,0,0);
    const output=ctx.getImageData(0,0,width,height);
    for(let pixel=0;pixel<output.data.length;pixel+=4){
      if(coverage[pixel]<128 || coverage[pixel+3]===0)continue;
      const opacity=edit[pixel+3]/255;
      for(let channel=0;channel<3;channel++){
        const index=pixel+channel;
        output.data[index]=edit[index]*opacity+output.data[index]*(1-opacity);
      }
    }
    ctx.putImageData(output,0,0);
    return canvas.toDataURL("image/png");
  }finally{images.forEach(bitmap=>bitmap.close());}
}
