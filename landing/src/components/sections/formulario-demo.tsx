"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "cn";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Campos = { nombre: string; correo: string; empresa: string; interes: string; acepta: boolean };
type Errores = Partial<Record<"nombre" | "correo" | "acepta", string>>;

const VACIO: Campos = { nombre: "", correo: "", empresa: "", interes: "", acepta: false };
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validar(c: Campos): Errores {
  const e: Errores = {};
  if (c.nombre.trim().length < 2) e.nombre = "Escribe tu nombre para saber a quién responder.";
  if (!c.correo.trim()) e.correo = "Escribe un correo para poder contactarte.";
  else if (!CORREO_VALIDO.test(c.correo.trim()))
    e.correo = "Ese correo no parece completo. Revisa que tenga @ y un dominio.";
  if (!c.acepta) e.acepta = "Marca la casilla para aceptar el tratamiento de tus datos.";
  return e;
}

const CAMPO =
  "h-11 rounded-none border-0 border-b border-ink bg-transparent px-0 text-lg text-ink shadow-none transition-shadow duration-200 placeholder:text-slate focus-visible:border-ink focus-visible:shadow-[inset_0_-2px_0_0_#0a1522] focus-visible:outline-none focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:shadow-[inset_0_-2px_0_0_#a3261a] aria-invalid:ring-0 md:text-lg";
const ETIQUETA = "text-sm font-semibold leading-5 text-slate";

export function FormularioDemo() {
  const id = useId();
  const [campos, setCampos] = useState<Campos>(VACIO);
  const [errores, setErrores] = useState<Errores>({});
  const [enviado, setEnviado] = useState<string | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const confirmacion = useRef<HTMLDivElement>(null);

  const cambiar = <K extends keyof Campos>(clave: K, valor: Campos[K]) => {
    setCampos((c) => ({ ...c, [clave]: valor }));
    if (clave in errores) setErrores((e) => ({ ...e, [clave]: undefined }));
  };

  const enviar = (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const encontrados = validar(campos);
    setErrores(encontrados);
    const primero = (["nombre", "correo", "acepta"] as const).find((k) => encontrados[k]);
    if (primero) {
      formulario.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${primero}`)}`)?.focus();
      return;
    }
    // Esta versión valida y confirma en la página: no envía datos a ningún servicio.
    setEnviado(campos.nombre.trim());
    setCampos(VACIO);
    requestAnimationFrame(() => confirmacion.current?.focus());
  };

  if (enviado) {
    return (
      <div
        ref={confirmacion}
        tabIndex={-1}
        role="status"
        data-estado="confirmado"
        className="flex animate-fade-up flex-col gap-6 outline-none [animation-duration:500ms]"
      >
        <CheckCircle aria-hidden="true" weight="regular" className="size-12 text-ink" />
        <div className="flex flex-col gap-3">
          <h2 className="text-3xl font-medium tracking-[-0.025em] lg:text-4xl">
            Solicitud validada, {enviado}
          </h2>
          <p className="text-base text-slate">
            Tus datos pasaron la revisión del formulario. Esta versión de demostración todavía no los
            envía a ningún servicio: el canal de contacto está por conectarse y nada salió de tu
            navegador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnviado(null)}
          className="flex min-h-11 items-center self-start text-base font-semibold underline"
        >
          Preparar otra solicitud
        </button>
      </div>
    );
  }

  return (
    <form ref={formulario} onSubmit={enviar} noValidate className="solicitud-grid grid gap-x-6 gap-y-5">
      <div className="col-span-full flex flex-col gap-3">
        <h2 className="text-3xl font-medium tracking-[-0.025em] lg:text-4xl">
          Solicita una demostración
        </h2>
        <p className="text-base text-slate">
          Te mostramos el proyecto de ejemplo, del terreno a la obra.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-nombre`} className={ETIQUETA}>
          Tu nombre
        </Label>
        <Input
          id={`${id}-nombre`}
          name="nombre"
          autoComplete="name"
          required
          value={campos.nombre}
          onChange={(e) => cambiar("nombre", e.target.value)}
          aria-invalid={errores.nombre ? true : undefined}
          aria-describedby={errores.nombre ? `${id}-nombre-error` : undefined}
          className={CAMPO}
        />
        {errores.nombre && (
          <p id={`${id}-nombre-error`} role="alert" className="text-sm font-medium text-destructive">
            {errores.nombre}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-correo`} className={ETIQUETA}>
          Correo
        </Label>
        <Input
          id={`${id}-correo`}
          name="correo"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={campos.correo}
          onChange={(e) => cambiar("correo", e.target.value)}
          aria-invalid={errores.correo ? true : undefined}
          aria-describedby={errores.correo ? `${id}-correo-error` : undefined}
          className={CAMPO}
        />
        {errores.correo && (
          <p id={`${id}-correo-error`} role="alert" className="text-sm font-medium text-destructive">
            {errores.correo}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-empresa`} className={ETIQUETA}>
          Empresa o estudio
        </Label>
        <Input
          id={`${id}-empresa`}
          name="empresa"
          autoComplete="organization"
          value={campos.empresa}
          onChange={(e) => cambiar("empresa", e.target.value)}
          className={CAMPO}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-interes`} className={ETIQUETA}>
          ¿Qué te gustaría ver?
        </Label>
        <Input
          id={`${id}-interes`}
          name="interes"
          value={campos.interes}
          onChange={(e) => cambiar("interes", e.target.value)}
          className={CAMPO}
        />
      </div>

      <div className="col-span-full flex flex-col gap-1.5">
        <div className="flex min-h-11 items-start gap-3">
          <Checkbox
            id={`${id}-acepta`}
            name="acepta"
            checked={campos.acepta}
            onCheckedChange={(valor) => cambiar("acepta", valor === true)}
            aria-invalid={errores.acepta ? true : undefined}
            aria-describedby={errores.acepta ? `${id}-acepta-error` : undefined}
            className={cn(
              "mt-0.5 size-5 rounded-[4px] border-ink bg-transparent data-checked:border-ink data-checked:bg-ink data-checked:text-bone",
            )}
          />
          <Label htmlFor={`${id}-acepta`} className="block text-sm font-normal leading-5 text-slate">
            Acepto el tratamiento de mis datos según la{" "}
            <Link href="/privacidad" className="font-semibold text-ink underline">
              política de privacidad
            </Link>
            .
          </Label>
        </div>
        {errores.acepta && (
          <p id={`${id}-acepta-error`} role="alert" className="text-sm font-medium text-destructive">
            {errores.acepta}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="col-span-full group flex h-[52px] items-center justify-between gap-4 self-stretch rounded-full bg-ink pl-6 pr-1.5 text-base font-semibold text-bone transition-transform duration-200 ease-out-quart active:scale-[0.98] sm:self-start"
      >
        Enviar solicitud
        <span className="grid size-10 place-items-center rounded-full bg-bone text-ink">
          <ArrowRight
            aria-hidden="true"
            weight="bold"
            className="size-[18px] transition-transform duration-500 ease-out-expo group-hover:translate-x-0.5"
          />
        </span>
      </button>
    </form>
  );
}
