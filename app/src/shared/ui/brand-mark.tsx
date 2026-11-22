/** ObraCota symbol and wordmark. The symbol is decorative: the word carries the name. */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return <span className={className ? "brand-mark " + className : "brand-mark"}>
    <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 10h48l-8 10H18L8 26zM8 30l10-6v17L8 47zM8 51l10-6h30l8 10H8z"/>
    </svg>
    <span>ObraCota</span>
  </span>;
}
