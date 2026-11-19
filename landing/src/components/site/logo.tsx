import { cn } from "cn";

/** Marca de ObraCota: tres cotas apiladas. */
export function LogoMarca({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)}>
      <path
        fill="currentColor"
        d="M8 10h48l-8 10H18L8 26zM8 30l10-6v17L8 47zM8 51l10-6h30l8 10H8z"
      />
    </svg>
  );
}

export function Logo({ className, compacto = false }: { className?: string; compacto?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-bone lg:gap-3.5", className)}>
      <LogoMarca className={compacto ? "size-5" : "size-[26px] lg:size-[34px]"} />
      <span
        className={cn(
          "font-semibold tracking-[-0.02em]",
          compacto ? "text-base" : "text-[22px] leading-7 lg:text-[28px] lg:leading-[34px]",
        )}
      >
        ObraCota
      </span>
    </span>
  );
}
