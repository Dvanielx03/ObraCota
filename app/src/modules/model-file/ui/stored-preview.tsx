"use client";
import { useSyncExternalStore } from "react";
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
 * The picture of the failure the workspace card is telling, matched by its message so a later,
 * different failure never shows a stale thumbnail.
 */
export function useOpenFailure(message: string): OpenFailure | null {
  const failure = useSyncExternalStore(openFailures.subscribe, openFailures.current, () => null);
  return failure && message && failure.message === message ? failure : null;
}
