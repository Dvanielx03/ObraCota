import Link from "next/link";
import "./legal.css";

export default function LegalLayout({children}:{children:React.ReactNode}) {
  return <main className="pilot-legal" id="contenido">
    <nav aria-label="Documentos del piloto">
      <Link href="/ingresar">Volver al ingreso</Link>
      <Link href="/terminos">Términos</Link>
      <Link href="/privacidad">Privacidad</Link>
    </nav>
    {children}
  </main>;
}
