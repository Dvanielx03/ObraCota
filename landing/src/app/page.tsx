import { Avance } from "@/components/sections/avance";
import { Contacto } from "@/components/sections/contacto";
import { Expediente } from "@/components/sections/expediente";
import { Hero } from "@/components/sections/hero";
import { Recorrido } from "@/components/sections/recorrido";

export default function Inicio() {
  return (
    <>
      <Hero />
      <Recorrido />
      <Expediente />
      <Avance />
      <Contacto />
    </>
  );
}
