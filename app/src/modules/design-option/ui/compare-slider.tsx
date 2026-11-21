"use client";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Before/after comparison: the model view on the left of the divider, the option on the right.
 * A native range input covers the image, so dragging, arrow keys, Home and End all work and the
 * position is announced. Nothing is animated: the divider follows the pointer.
 */
export function CompareSlider({ before, after, beforeLabel, afterLabel, label, onClose }: {
  before: string; after: string; beforeLabel: string; afterLabel: string; label: string; onClose: () => void;
}) {
  const [position, setPosition] = useState(50);
  // The stage takes the option's own proportion and never grows taller than the dialog allows.
  const [ratio, setRatio] = useState(1.6);
  const id = useId();
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest" });
  }, [ratio]);
  return (
    <section ref={root} className="compare" aria-label={label}>
      <div className="compare-stage" style={{ "--compare": position + "%", "--ratio": ratio } as React.CSSProperties}>
        <img className="compare-after" src={after} alt={afterLabel}
          onLoad={(event) => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalHeight) setRatio(naturalWidth / naturalHeight); }} />
        <img className="compare-before" src={before} alt={beforeLabel} />
        <input
          id={id}
          className="compare-range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          aria-label="Posición del divisor"
          aria-valuetext={`${position} % de la vista del modelo`}
          onChange={(event) => setPosition(Number(event.target.value))}
        />
        <span className="compare-handle" aria-hidden="true"><i /></span>
        <span className="compare-tag compare-tag-before" aria-hidden="true">{beforeLabel}</span>
        <span className="compare-tag compare-tag-after" aria-hidden="true">{afterLabel}</span>
      </div>
      <div className="compare-footer">
        <p>Arrastra el divisor o usa las flechas. La imagen de la derecha está generada con IA: sirve para decidir, no para medir.</p>
        <button type="button" onClick={onClose}>Cerrar comparación</button>
      </div>
    </section>
  );
}
