"use client";
import { useSyncExternalStore } from "react";
import { openFailures, type OpenFailure } from "@/viewer/domain/open-failure";
import { RevitTranslationAction } from "@/modules/model-version/ui/revit-translation";

/**
 * Under the reason a file could not be drawn: the thumbnail a DWG keeps (the picture AutoCAD shows in
 * its file dialog) with the way forward when the manufacturer's package has a mesh, or the Revit
 * release of an RVT with the picture Revit stored, when it shows something. A stored RVT also offers its
 * conversion to IFC with Autodesk (`stored` names the version).
 */
export function StoredPreview({ failure, stored }: { failure: OpenFailure; stored?: { project: string; version: string } }) {
  if (failure.reason === "revit") return <figure className="open-failure-preview">
    {/* eslint-disable-next-line @next/next/no-img-element -- object URL of the bytes read from the RVT */}
    {failure.preview && <img src={failure.preview} alt={"Vista previa guardada en " + failure.file}/>}
    <figcaption><strong>Original de Revit{failure.revit?.release ? " " + failure.revit.release : ""}</strong>
      {failure.revit?.build && <span>Compilación {failure.revit.build}.</span>}
      <span>{failure.preview ? "Imagen PNG que Revit guardó con el archivo: se ve, pero no se puede girar ni medir. "
        : ""}{failure.revit?.stored ? "El original sigue descargable desde el historial de versiones." : ""}</span>
      {failure.revit?.stored && stored && <RevitTranslationAction project={stored.project} version={stored.version}/>}</figcaption>
  </figure>;
  if (!failure.preview) return null;
  return <figure className="open-failure-preview">
    {/* eslint-disable-next-line @next/next/no-img-element -- object URL of the bytes read from the DWG */}
    <img src={failure.preview} alt={"Miniatura guardada en " + failure.file}/>
    <figcaption><strong>Vista previa guardada en el DWG</strong>
      <span>Imagen {failure.kind} que AutoCAD guardó con el archivo{failure.cropped ? ", recortada a su contenido" : ""}: se ve, pero no se puede girar ni medir.</span>
      <span>Si el paquete del fabricante trae FBX u OBJ, súbelo para verlo en 3D.</span></figcaption>
  </figure>;
}

/**
 * The details of the failure the workspace card is telling, matched by its message so a later,
 * different failure never shows a stale thumbnail.
 */
export function useOpenFailure(message: string): OpenFailure | null {
  const failure = useSyncExternalStore(openFailures.subscribe, openFailures.current, () => null);
  return failure && message && failure.message === message ? failure : null;
}
