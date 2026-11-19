import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NoEncontrada() {
  return (
    <section className="flex min-h-[max(100svh,640px)] flex-col justify-end gap-8 bg-ink px-4 pb-16 pt-40 lg:px-12 lg:pb-24">
      <h1 className="display-hero text-bone">
        <span className="line-mask">
          <span className="block animate-rise">Lámina</span>
        </span>
        <span className="line-mask">
          <span className="block animate-rise [animation-delay:90ms]">no encontrada</span>
        </span>
      </h1>
      <p className="max-w-[32rem] text-lg text-mist">
        Error 404. Esta dirección no corresponde a ninguna página del sitio. Puede que el enlace haya
        cambiado o esté mal escrito.
      </p>
      <Link
        href="/"
        className="group flex h-12 items-center gap-3 self-start rounded-full bg-bone pl-6 pr-1.5 text-base font-semibold text-ink transition-transform duration-200 ease-out-quart active:scale-[0.98]"
      >
        Volver al inicio
        <span className="grid size-9 place-items-center rounded-full bg-ink text-bone">
          <ArrowRight
            aria-hidden="true"
            weight="bold"
            className="size-4 transition-transform duration-500 ease-out-expo group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </section>
  );
}
