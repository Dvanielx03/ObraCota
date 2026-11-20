import {useEffect,useRef,useState} from "react";

const minWidth=210;
function maximum(width:number){return Math.min(460,Math.floor(width*.45));}

export function SidebarWidth(){
  const handle=useRef<HTMLDivElement>(null);
  const drag=useRef<{x:number;width:number}|null>(null);
  const [size,setSize]=useState({now:260,max:460});
  useEffect(()=>{
    const panel=handle.current!.parentElement!, area=panel.parentElement!;
    const observer=new ResizeObserver(()=>{
      if(panel.clientWidth)setSize({now:Math.round(panel.getBoundingClientRect().width),max:maximum(area.clientWidth)});
    });
    observer.observe(panel);observer.observe(area);return ()=>observer.disconnect();
  },[]);
  function resize(width:number){
    const area=handle.current!.parentElement!.parentElement!;
    area.style.setProperty("--sidebar-width",Math.max(minWidth,Math.min(maximum(area.clientWidth),width))+"px");
  }
  return <div ref={handle} role="separator" aria-orientation="vertical" aria-label="Ancho del panel" aria-controls="explorer"
    aria-valuemin={minWidth} aria-valuemax={size.max} aria-valuenow={size.now} aria-valuetext={size.now+" píxeles"}
    tabIndex={0} className="sidebar-grip" title="Arrastra o usa las flechas para ajustar el ancho"
    onPointerDown={e=>{
      if(e.button!==0)return;
      e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
      drag.current={x:e.clientX,width:e.currentTarget.parentElement!.getBoundingClientRect().width};
    }}
    onPointerMove={e=>{if(drag.current)resize(drag.current.width+e.clientX-drag.current.x);}}
    onLostPointerCapture={()=>{drag.current=null;}}
    onKeyDown={e=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;
      e.preventDefault();
      resize(e.key==="Home"?minWidth:e.key==="End"?size.max:size.now+(e.key==="ArrowLeft"?-16:16));
    }}/>;
}
