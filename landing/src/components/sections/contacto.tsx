import Image from "next/image";

import { FormularioDemo } from "./formulario-demo";

export function Contacto() {
  return (
    <section id="contacto" className="relative isolate bg-ink-deep lg:px-12 lg:pb-[clamp(2rem,6svh,5rem)] lg:pt-[clamp(6.75rem,12svh,8rem)]">
      <div className="relative h-[clamp(8rem,25svh,20rem)] lg:absolute lg:inset-0 lg:-z-10 lg:h-auto">
        <Image
          src="/images/foto-contacto.webp"
          alt="Detalle del pabellón al anochecer: columna de concreto, baranda de acero, escalera y un aula iluminada"
          fill
          sizes="100vw"
          className="object-cover object-[78%_50%] lg:object-center"
        />
      </div>
      <div className="on-bone relative mx-4 -mt-12 mb-12 rounded-xl bg-bone px-6 py-8 text-ink lg:mx-auto lg:my-0 lg:w-full lg:max-w-[1344px] lg:bg-transparent lg:p-0">
        <div className="lg:w-[min(46vw,42rem)] lg:rounded-xl lg:bg-bone lg:p-[clamp(1.5rem,3vw,3rem)]">
          <FormularioDemo />
        </div>
      </div>
    </section>
  );
}
