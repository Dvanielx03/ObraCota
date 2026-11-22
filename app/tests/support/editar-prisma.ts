import type {Page} from "@playwright/test";

/**
 * Prisma dejó de ser una sección (DU-16): su selección, su vista previa local y la edición con
 * máscara viven ahora en EDITAR. Estos localizadores siguen el código de la interfaz:
 * workspace-tools.tsx (barra inferior), selection-assistant.tsx (panel «Selección» del explorador),
 * edit-bar.tsx (subbarra de Editar) y prisma-tour.tsx (guía de Editar).
 */

/** Botón EDITAR de la barra inferior («Acciones del modelo»). */
export const editButton=(page:Page)=>page.getByRole("toolbar",{name:"Acciones del modelo"}).getByRole("button",{name:"Editar",exact:true});

/** Subbarra flotante de Editar. */
export const editBar=(page:Page)=>page.getByRole("toolbar",{name:"Herramientas de Editar"});

/** Panel «Selección» que Editar muestra dentro del explorador. */
export const selectionPanel=(page:Page)=>page.getByRole("region",{name:"Selección",exact:true});

/** Tarjeta de la guía visual de Editar (antes «Guía visual de Prisma»). */
export const editTour=(page:Page)=>page.getByRole("region",{name:"Guía visual de Editar"});
