"use client";
import { useEffect, useRef, useState } from "react";
import { HttpError } from "@/core/http/http-client";
import { Skeleton } from "@/shared/ui/loading";
import { SOURCE_LABELS, propertyText, type ElementProperties as Reading } from "../domain/element-properties";
import { elementReader } from "../infrastructure/element-reader";
import "./element-properties.css";

type Scope = { project: string; version: string };
type State = { guid: string; reading?: Reading; error?: string };

/**
 * «Conjuntos de propiedades» of one piece of a stored IFC version (§7.6): the psets of the piece and of its type,
 * each with its origin, and every property with its value and IFC type. It reads the engine only once the section
 * is opened, and keeps what it read for the pieces already seen while the version is open.
 */
export function ElementProperties({ scope, guid }: { scope: Scope; guid: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ guid });
  const cache = useRef(new Map<string, Reading>());
  const key = scope.project + "/" + scope.version;
  useEffect(() => { cache.current.clear(); }, [key]);
  useEffect(() => {
    if (!open) return;
    const known = cache.current.get(guid);
    if (known) { setState({ guid, reading: known }); return; }
    const control = new AbortController();
    setState({ guid });
    elementReader.properties(scope, guid, control.signal).then(reading => {
      if (control.signal.aborted) return;
      cache.current.set(guid, reading);
      setState({ guid, reading });
    }).catch(error => {
      if (control.signal.aborted) return;
      setState({ guid, error: error instanceof HttpError && error.status !== 500 && error.message
        ? error.message : "No se pudieron leer los conjuntos de propiedades." });
    });
    return () => control.abort();
    // scope is compared through its key: a new object for the same version must not read again.
  }, [open, guid, key]);
  const current = state.guid === guid ? state : { guid };
  return <details className="element-psets" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Conjuntos de propiedades{current.reading ? <small>{current.reading.psets.length}</small> : null}</summary>
    {open && <div className="element-psets-body" aria-busy={!current.reading && !current.error}>
      {current.error ? <p role="alert">{current.error}</p>
        : !current.reading ? <div className="element-psets-loading" aria-label="Leyendo propiedades">
            <Skeleton shape="line" width="54%"/><Skeleton shape="line"/><Skeleton shape="line" width="78%"/><Skeleton shape="line" width="64%"/></div>
        : !current.reading.psets.length ? <p>Esta pieza no declara conjuntos de propiedades en el IFC.</p>
        : current.reading.psets.map(pset => <section key={pset.source + ":" + pset.name} className="element-pset" aria-label={pset.name + " " + SOURCE_LABELS[pset.source]}>
            <h3><span className="guid">{pset.name}</span><span className="element-pset-source" data-source={pset.source}
              title={pset.source === "type" ? "Lo heredan todas las piezas de este tipo que no tienen valor propio." : pset.shared_by > 1 ? "Este conjunto lo comparten " + pset.shared_by + " piezas." : undefined}>
              {SOURCE_LABELS[pset.source]}{pset.source === "occurrence" && pset.shared_by > 1 ? " · " + pset.shared_by + " piezas" : ""}</span></h3>
            {pset.properties.length ? <dl>{pset.properties.map(property => <div key={property.name} className="element-property" data-property={property.name}>
                <dt>{property.name}</dt>
                <dd><span>{propertyText(property.value)}</span>{property.ifc_type && <small className="guid">{property.ifc_type}</small>}</dd>
              </div>)}</dl>
              : <p>Sin propiedades.</p>}
          </section>)}
      {current.reading && <small className="element-psets-note">Leído del archivo de esta versión. Las cantidades (Qto) no se muestran aquí.</small>}
    </div>}
  </details>;
}
