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
          <h3 className="text-2xl font-semibold tracking-[-0.02em] lg:text-3xl">
            Solicitud validada, {enviado}
          </h3>
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

  const campo = (clave: "nombre" | "correo" | "empresa" | "interes", etiqueta: string, extra: React.ComponentProps<typeof Input> = {}) => {
    const error = clave === "nombre" || clave === "correo" ? errores[clave] : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-${clave}`} className="text-sm font-semibold leading-5 tracking-[0.012em] text-ink">
          {etiqueta}
        </Label>
          <Input
            id={`${id}-${clave}`}
            name={clave}
            value={campos[clave]}
            onChange={(e) => cambiar(clave, e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-${clave}-error` : undefined}
            className="h-11 rounded-xl border-ink/45 bg-white/55 px-3.5 text-base tracking-normal text-ink hover:border-ink/65 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 aria-invalid:border-destructive md:text-base dark:bg-white/55 dark:aria-invalid:border-destructive"
            {...extra}
          />
        {error && (
          <p id={`${id}-${clave}-error`} role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form ref={formulario} onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {campo("nombre", "Tu nombre", { autoComplete: "name", required: true })}
        {campo("correo", "Correo", { type: "email", inputMode: "email", autoComplete: "email", required: true })}
        {campo("empresa", "Empresa o estudio", { autoComplete: "organization" })}
        {campo("interes", "¿Qué te gustaría ver?")}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-ink/15 pt-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${id}-acepta`}
            name="acepta"
            checked={campos.acepta}
            onCheckedChange={(valor) => cambiar("acepta", valor === true)}
            aria-invalid={errores.acepta ? true : undefined}
            aria-describedby={errores.acepta ? `${id}-acepta-error` : undefined}
            className={cn(
              "mt-0.5 size-5 rounded-[4px] border-ink/60 bg-bone dark:bg-bone dark:data-checked:bg-ink data-checked:border-ink data-checked:bg-ink data-checked:text-bone",
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
        className="group flex h-[52px] items-center gap-4 self-start rounded-full bg-ink pl-6 pr-1.5 text-base font-semibold text-bone transition-transform duration-200 ease-out-quart active:scale-[0.98]"
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
