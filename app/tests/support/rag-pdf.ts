import type {Page} from "@playwright/test";
import {deflateSync} from "node:zlib";

/**
 * Test PDFs built byte by byte, so every value the RAG tests expect (datum, unit, page and section) is fixed by the
 * fixture itself. Text PDFs use Helvetica with WinAnsiEncoding (PDFBox extracts it as Unicode); scanned PDFs carry
 * only a grey image per page, rendered from a canvas, so the server must OCR them. Each page has an outline entry:
 * the server reads it as the section of the page.
 */
export type SheetPage={section:string;lines:string[]};

function literal(text:string){
  let out="(";
  for(const char of text){
    const code=char.codePointAt(0)!;
    if(char==="("||char===")"||char==="\\")out+="\\"+char;
    else if(code>=32&&code<127)out+=char;
    // Latin-1 letters (á, é, ñ, ¿, °, ²…) are the same bytes in WinAnsi and PDFDocEncoding.
    else if(code>=160&&code<=255)out+="\\"+code.toString(8).padStart(3,"0");
    else throw new Error("Carácter fuera de WinAnsi en el PDF de prueba: "+char);
  }
  return out+")";
}

const stream=(dict:string,body:Buffer)=>Buffer.concat([Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`),body,Buffer.from("\nendstream")]);

function assemble(objects:Buffer[]){
  let pdf=Buffer.from("%PDF-1.4\n");
  const xref=["0000000000 65535 f \n"];
  objects.forEach((body,index)=>{
    xref.push(String(pdf.length).padStart(10,"0")+" 00000 n \n");
    pdf=Buffer.concat([pdf,Buffer.from(`${index+1} 0 obj\n`),body,Buffer.from("\nendobj\n")]);
  });
  return Buffer.concat([pdf,Buffer.from(`xref\n0 ${xref.length}\n${xref.join("")}trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`)]);
}

/** Outline items for pages numbered from `first` with `per` objects each, the item being the last of them. */
function outline(sections:string[],first:number,per:number){
  return sections.map((title,i)=>{
    const self=first+per*i+per-1,page=first+per*i;
    const links=(i>0?` /Prev ${self-per} 0 R`:"")+(i<sections.length-1?` /Next ${self+per} 0 R`:"");
    return Buffer.from(`<< /Title ${literal(title)} /Parent 3 0 R /Dest [${page} 0 R /Fit]${links} >>`);
  });
}

/** A digital PDF: each page is a list of lines (end them with a period so each one reads as a sentence). */
export function textPdf(pages:SheetPage[]){
  const first=5,per=3;
  const kids=pages.map((_,i)=>`${first+per*i} 0 R`).join(" ");
  const items=outline(pages.map(p=>p.section),first,per);
  const objects=[
    Buffer.from("<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R >>"),
    Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`),
    Buffer.from(`<< /Type /Outlines /First ${first+per-1} 0 R /Last ${first+per*pages.length-1} 0 R /Count ${pages.length} >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
  ];
  pages.forEach((page,i)=>{
    const body="BT /F1 13 Tf 18 TL 56 770 Td "+[page.section+".",...page.lines].map(line=>literal(line)+" Tj T*").join(" ")+" ET";
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents ${first+per*i+1} 0 R >>`));
    objects.push(stream("",Buffer.from(body,"latin1")));
    objects.push(items[i]);
  });
  return assemble(objects);
}

/** An image-only PDF (no text layer): the lines of each page are drawn on a canvas in the page and kept as grey pixels. */
export async function scannedPdf(page:Page,pages:SheetPage[]){
  const width=1100,height=420;
  const images:number[][]=[];
  for(const sheet of pages)images.push(await page.evaluate(({lines,width,height})=>{
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext("2d")!;
    context.fillStyle="white";context.fillRect(0,0,width,height);
    context.fillStyle="black";context.font="36px Arial";
    lines.forEach((line,i)=>context.fillText(line,40,80+i*72));
    return [...context.getImageData(0,0,width,height).data.filter((_,i)=>i%4===0)];
  },{lines:sheet.lines,width,height}));
  const first=4,per=4;
  const kids=pages.map((_,i)=>`${first+per*i} 0 R`).join(" ");
  const items=outline(pages.map(p=>p.section),first,per);
  const objects=[
    Buffer.from("<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R >>"),
    Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`),
    Buffer.from(`<< /Type /Outlines /First ${first+per-1} 0 R /Last ${first+per*pages.length-1} 0 R /Count ${pages.length} >>`),
  ];
  images.forEach((pixels,i)=>{
    const base=first+per*i;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width/2} ${height/2}] /Resources << /XObject << /Scan ${base+1} 0 R >> >> /Contents ${base+2} 0 R >>`));
    objects.push(stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,deflateSync(Buffer.from(pixels))));
    objects.push(stream("",Buffer.from(`q ${width/2} 0 0 ${height/2} 0 0 cm /Scan Do Q`)));
    objects.push(items[i]);
  });
  return assemble(objects);
}
