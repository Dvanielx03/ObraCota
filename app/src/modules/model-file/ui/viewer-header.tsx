"use client";
import type { ReactNode, RefObject } from "react";
import { ChevronRight, CircleHelp, FolderOpen, Presentation, Share2, X } from "lucide-react";
import { ThemeToggle } from "@/shared/theme/theme-toggle";
import { BrandMark } from "@/shared/ui/brand-mark";
import { MODEL_ACCEPT } from "../domain/file-header";
import { OpenFailurePreview } from "./open-failure-preview";

interface HeaderAction { ref: RefObject<HTMLButtonElement | null>; disabled: boolean; onClick: () => void; title?: string }

/**
 * 52 px bar that floats over the canvas: brand link › project · file and share on the left;
 * theme, export, present, open, help and close on the right. The bar itself lets pointer
 * events through so the model can still be orbited between its controls. `inert` while the
 * presentation covers the page.
 */
export function ViewerHeader({ returnHref, returnLabel, projectName, fileName, pending, meta, badge, input, onFile, openDisabled, exportMenu, present, help, onClose, inert }: {
  returnHref: string; returnLabel: string; projectName?: string; fileName: string; pending?: boolean; meta?: string;
  /** Badge after the file name, e.g. «Vista previa sin publicar» and what the proposal changes. */
  badge?: { label: string; detail?: string };
  input: RefObject<HTMLInputElement | null>; onFile: (file: File) => void; openDisabled: boolean;
  /** The "Exportar" pill and its menu. */
  exportMenu: ReactNode;
  present: HeaderAction; help: HeaderAction; onClose?: () => void; inert?: boolean;
}) {
  return <header className="viewer-header" inert={inert}>
    <div className="viewer-crumbs">
      <a href={returnHref} className="brand viewer-back" aria-label={returnLabel} title={returnLabel}>
        <BrandMark wordmark={false}/>
      </a>
      <ChevronRight className="crumb-chevron" size={24} strokeWidth={2} aria-hidden="true"/>
      {projectName && <><span className="project-name" title={projectName}>{projectName}</span>{!pending && <span className="crumb-dot" aria-hidden="true">·</span>}</>}
      {/* While a stored version opens, the project name stands alone; the placeholder stays for screen readers. */}
      <span className={"project" + (projectName && pending ? " visually-hidden" : "")} data-secondary={projectName ? "" : undefined}
        title={meta ? fileName + " · " + meta : fileName}>{fileName}</span>
      {badge && <span className="viewer-badge" title={badge.detail ? badge.label + " · " + badge.detail : badge.label}>
        <strong>{badge.label}</strong>{badge.detail && <span>{badge.detail}</span>}</span>}
      <button type="button" className="header-icon header-share" aria-label="Compartir" aria-disabled="true" title="Pendiente: compartir por enlace">
        <Share2 size={16} strokeWidth={2} aria-hidden="true"/></button>
    </div>
    <input hidden ref={input} type="file" accept={MODEL_ACCEPT} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }}/>
    <OpenFailurePreview/>
    <div className="viewer-actions">
      <ThemeToggle/>
      {exportMenu}
      <button ref={present.ref} type="button" className="header-pill header-present" disabled={present.disabled} title={present.title} onClick={present.onClick}>
        <Presentation size={12} strokeWidth={2} aria-hidden="true"/>Presentar</button>
      <button type="button" className="open header-icon" aria-label="Abrir archivo" title="Abrir un IFC, DWG, FBX u OBJ de tu equipo" disabled={openDisabled}
        onClick={() => input.current?.click()}><FolderOpen size={16} strokeWidth={2} aria-hidden="true"/><span className="open-label">Abrir archivo</span></button>
      <button ref={help.ref} type="button" className="help-icon header-icon" aria-label="Guía de uso" title={"Guía de uso\nAtajos de teclado: ?"} aria-haspopup="dialog"
        disabled={help.disabled} onClick={help.onClick}><CircleHelp size={16} strokeWidth={2} aria-hidden="true"/></button>
      {onClose && <button type="button" className="header-close header-icon" aria-label="Cerrar modelo" title="Cerrar modelo" onClick={onClose}>
        <X size={16} strokeWidth={2} aria-hidden="true"/></button>}
    </div>
  </header>;
}
