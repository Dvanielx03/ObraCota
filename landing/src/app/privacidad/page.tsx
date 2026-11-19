import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacidad",
  description: "Qué hace y qué no hace esta versión de demostración de ObraCota con tus datos.",
};

export default function Privacidad() {
  return (
    <article className="on-bone bg-bone px-4 pb-20 pt-36 text-ink lg:px-12 lg:pb-28 lg:pt-48">
      <div className="mx-auto flex max-w-[44rem] flex-col gap-10">
        <h1 className="display-section">Privacidad</h1>

        <div className="flex flex-col gap-6 text-lg">
          <p>
            ObraCota es hoy un proyecto académico en fase de definición. Esta página describe, sin
            adornos, qué ocurre con los datos que escribes en este sitio.
          </p>

          <h2 className="text-2xl font-semibold">Lo que hace esta versión</h2>
          <p>
            El formulario «Solicita una demostración» revisa en tu navegador que el nombre y el correo
            estén completos y te muestra una confirmación. No envía esos datos a ningún servidor, no
            los guarda y no los comparte: se pierden al cerrar o recargar la página.
          </p>
          <p>
            El sitio no usa cookies de seguimiento ni herramientas de analítica.
          </p>

          <h2 className="text-2xl font-semibold">Lo que falta</h2>
          <p>
            Cuando el formulario se conecte a un canal de contacto real, esta página se reemplazará
            por una política de tratamiento de datos personales con responsable, finalidades y
            canales de consulta, conforme a la Ley 1581 de 2012 de Colombia. Ese texto requiere
            revisión jurídica y todavía no existe.
          </p>
        </div>

        <Link href="/#contacto" className="flex min-h-11 items-center self-start text-base font-semibold underline">
          Volver al formulario
        </Link>
      </div>
    </article>
  );
}
