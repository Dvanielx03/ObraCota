import Link from "next/link";

import { Logo } from "./logo";

export function SiteFooter() {
  const panel = process.env.NEXT_PUBLIC_PANEL_URL?.replace(/\/$/, "");
  return (
    <footer className="border-t border-bone/15 bg-ink-deep">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-12 lg:py-9">
        <Logo compacto />
        <p className="max-w-[40rem] text-sm text-mist">
          Proyecto académico. El Pabellón Arrayán y sus cifras son un caso de muestra. El modelo 3D
          del recorrido es un edificio real publicado como dato abierto; su fuente y licencia figuran
          junto al visor.
        </p>
        <nav aria-label="Pie de página" className="flex flex-wrap gap-x-6 text-sm font-semibold">
          <Link href="/privacidad" className="flex min-h-11 items-center underline">
            Privacidad
          </Link>
          {panel && <>
            <a href={panel + "/terminos"} className="flex min-h-11 items-center underline">Términos del piloto</a>
            <a href={panel + "/privacidad"} className="flex min-h-11 items-center underline">Privacidad de cuentas</a>
          </>}
          <Link href="/#inicio" className="flex min-h-11 items-center underline">
            Volver al inicio
          </Link>
        </nav>
      </div>
    </footer>
  );
}
