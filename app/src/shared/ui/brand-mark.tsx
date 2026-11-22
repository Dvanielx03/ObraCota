/**
 * ObraCota symbol, «Cota de nivel» (direction A, chosen on 22 Nov 2026).
 *
 * Three floors of a building cut at 45° like a level mark; the middle one, in the brand accent, is the
 * modified level: what ObraCota changes and reviews. Grid of 24: bars 4 high with 2 of air, useful
 * lengths 14.5, 18 and 9.5. At 24 px (or a multiple) every edge lands on a whole pixel; at 26 px the bars
 * blur, so the viewer headers centre the 24 px symbol in their 26 px link. The master drawing is
 * obracota-isotipo.svg in the creative direction folder; src/app/icon.svg is its 16 px variant (bars of 3
 * with 2 of air, snapped to whole pixels).
 *
 * Origin: drawn by hand for ObraCota. It replaces two earlier marks that were also drawn for this project:
 * the 64-grid «stacked levels» of this component (19 Nov) and the 25 × 23 symbol of the viewer header
 * (first written in the local viewer on 20 Nov and later copied into the three viewers). Neither came
 * from the reference application.
 */
export const BRAND_SYMBOL = {
  viewBox: "0 0 24 24",
  top: "M3 4h14.5l-4 4H3z",
  level: "M3 10h18l-4 4H3z",
  base: "M3 16h9.5l-4 4H3z",
} as const;

/** The symbol alone. Outer bars take the text colour; the level bar takes --brand-mark. */
export function BrandSymbol({ size = 24 }: { size?: number }) {
  return <svg className="brand-symbol" viewBox={BRAND_SYMBOL.viewBox} width={size} height={size} aria-hidden="true" focusable="false">
    <path fill="currentColor" d={BRAND_SYMBOL.top}/>
    <path className="brand-symbol-level" d={BRAND_SYMBOL.level}/>
    <path fill="currentColor" d={BRAND_SYMBOL.base}/>
  </svg>;
}

/**
 * Symbol and wordmark. The symbol is decorative: the word carries the name. Without the wordmark the
 * caller names the link (the viewer headers use it as «Volver a…»).
 */
export function BrandMark({ size = 24, wordmark = true, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return <span className={className ? "brand-mark " + className : "brand-mark"}>
    <BrandSymbol size={size}/>
    {wordmark && <span>ObraCota</span>}
  </span>;
}
