import { cn } from "cn";

/**
 * Marca de ObraCota «Cota de nivel»: tres niveles cortados a 45°; el del centro, en el acento propio, es el
 * nivel modificado. Retícula de 24, la misma del isotipo de la aplicación (`app/src/shared/ui/brand-mark.tsx`).
 * El sitio es oscuro, así que el acento usa la variante para fondo oscuro (#34D399, 8:1 sobre la tinta).
 */
export function LogoMarca({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cn("size-8 shrink-0", className)}>
      <path fill="currentColor" d="M3 4h14.5l-4 4H3z" />
      <path fill="#34D399" d="M3 10h18l-4 4H3z" />
      <path fill="currentColor" d="M3 16h9.5l-4 4H3z" />
    </svg>
  );
}

export function Logo({ className, compacto = false }: { className?: string; compacto?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-bone lg:gap-3.5", className)}>
      <LogoMarca className={compacto ? "size-6" : "size-6 lg:size-9"} />
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
