export type DocumentIndex = {
  status: "LEGACY" | "QUEUED" | "PROCESSING" | "INDEXED" | "TEXT_ONLY" | "FAILED";
  error: string | null;
  originalAvailable: boolean;
};

export function isIndexPending(document: DocumentIndex) {
  return document.status === "QUEUED" || document.status === "PROCESSING";
}

export function documentStatus(document: DocumentIndex) {
  switch (document.status) {
    case "QUEUED": return "En cola para indexar";
    case "PROCESSING": return "Extrayendo e indexando el texto";
    case "LEGACY":
    case "INDEXED": return "Lista para consultar";
    case "TEXT_ONLY": return "Lista para búsqueda de texto";
    case "FAILED": {
      const reasons: Record<string, string> = {
        NO_EXTRACTABLE_TEXT: "El PDF no contiene texto legible.",
        ACTIVE_PDF: "El PDF contiene acciones o archivos incrustados.",
        MALWARE: "El escáner rechazó el PDF.",
        SCANNER_UNAVAILABLE: "El escáner de archivos no está disponible.",
        UPLOAD_LOST: "La copia temporal se perdió. Vuelve a cargar el PDF.",
        TOO_MUCH_TEXT: "El contenido supera el límite de indexación.",
      };
      return reasons[document.error ?? ""] ?? "No se pudo indexar el PDF. Comprueba el archivo y vuelve a cargarlo.";
    }
  }
}
