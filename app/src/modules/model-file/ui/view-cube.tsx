import type {ViewDirection} from "@/viewer/domain/viewer.port";
const faces: [ViewDirection,string][] = [["front","Frente"],["back","Atrás"],["left","Izq."],["right","Der."],["top","Planta"],["bottom","Base"]];
export function ViewCube({orient,flat}:{orient:(view:ViewDirection)=>void;flat:boolean}) {
  return <div className="orientation" aria-label="Orientación del modelo">
    <label className="view-picker">
      <span className="cube" aria-hidden="true"><span className="faces">{faces.map(([view,label])=>
        <span key={view} className={"face face-"+view}>{label}</span>
      )}</span></span>
      <span className="view-picker-caption">Vistas ▾</span>
      <select aria-label="Cambiar orientación" value="" onChange={e=>orient(e.target.value as ViewDirection)}>
        <option value="" disabled>Elegir vista</option>
        <option value="top">{flat?"Planta · vista del plano":"Planta"}</option>
        <option value="iso">Isométrica</option>
        {faces.filter(([view])=>view!=="top").map(([view,label])=>
          <option key={view} value={view}>{view==="left"?"Izquierda":view==="right"?"Derecha":label}</option>)}
      </select>
    </label>
    <svg className="axis-triad" viewBox="0 0 68 56" role="img" aria-label="Ejes del dibujo X, Y y Z">
      {["X","Y","Z"].map(axis=><g key={axis} data-axis={axis}><line x1="34" y1="28"/><text>{axis}</text></g>)}
    </svg>
  </div>;
}
