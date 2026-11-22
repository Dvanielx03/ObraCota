import type { ReactNode } from "react";
import { LoaderArt } from "./loader-art";
import { Spinner } from "./spinner";

/**
 * Wait over the canvas while a model opens: the animation of the step, a live line with the phase
 * the workers report («Leyendo niveles y materiales…»), the file and an optional action (Cancelar).
 * `stage="viewer"` is the editor starting (orbiting massing model); `stage="model"` is the file
 * being read (building assembled floor by floor). The layer lets the pointer through outside its
 * own content, so the header and the panels stay usable.
 */
export function ModelPreparing({ phase, stage, detail, children, className }: {
  phase: string; stage: "viewer" | "model"; detail?: string; children?: ReactNode; className?: string;
}) {
  return <div className={"model-preparing" + (className ? " " + className : "")} data-stage={stage}>
    <LoaderArt name={stage} size={168} />
    <div className="model-preparing-text">
      <p className="model-preparing-phase" role="status"><Spinner size={16} /><span>{phase}</span></p>
      {detail && <p className="model-preparing-detail" title={detail}>{detail}</p>}
    </div>
    {children && <div className="model-preparing-actions">{children}</div>}
  </div>;
}
