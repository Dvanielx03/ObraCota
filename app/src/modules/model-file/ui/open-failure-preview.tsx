"use client";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { openFailures, type OpenFailure } from "@/viewer/domain/open-failure";

/**
 * The thumbnail a DWG keeps (the picture AutoCAD shows in its file dialog) under the reason it could
 * not be drawn, with the way forward when the manufacturer's package has a mesh. Shows nothing when
 * the DWG stores no thumbnail.
 */
export function StoredPreview({ failure }: { failure: OpenFailure }) {
  return <figure className="open-failure-preview">
    {/* eslint-disable-next-line @next/next/no-img-element -- object URL of the bytes read from the DWG */}
    <img src={failure.preview} alt={"Miniatura guardada en " + failure.file}/>
    <figcaption><strong>Vista previa guardada en el DWG</strong>
      <span>Imagen {failure.kind} que AutoCAD guardó con el archivo{failure.cropped ? ", recortada a su contenido" : ""}: se ve, pero no se puede girar ni medir.</span>
      {failure.reason === "acis" && <span>Si el paquete del fabricante trae FBX u OBJ, súbelo para verlo en 3D.</span>}</figcaption>
  </figure>;
}

/**
 * Places StoredPreview inside the workspace's «No se pudo abrir» card while that card tells the same
 * failure. Mounted by the viewer header, which re-renders with the workspace, so the card itself keeps
 * showing only text. TODO(H1 merge): render <StoredPreview/> directly under the error paragraph of
 * viewer-workspace.tsx and drop this portal.
 */
export function OpenFailurePreview() {
  const failure = useSyncExternalStore(openFailures.subscribe, openFailures.current, () => null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!failure) { setCard(null); return; }
    const find = () => {
      const found = [...document.querySelectorAll<HTMLElement>(".stage .feedback[data-kind=error]")]
        .find(node => node.querySelector(":scope > p")?.textContent === failure.message) ?? null;
      setCard(previous => previous === found ? previous : found);
    };
    find();
    // The card mounts and unmounts on its own schedule; watch the page instead of waiting for a render.
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [failure]);
  return failure && card?.isConnected ? createPortal(<StoredPreview failure={failure}/>, card) : null;
}
