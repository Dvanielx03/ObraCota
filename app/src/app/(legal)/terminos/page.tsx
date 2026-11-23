import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Términos del piloto · ObraCota", robots: { index: false, follow: false } };

export default function TermsPage() {
  return <article>
    <p className="pilot-note">Piloto privado · Borrador para revisión</p>
    <h1>Términos de participación</h1>
    <p>ObraCota es un proyecto académico dirigido por Daniel Santiago Mayorga, estudiante a cargo del piloto en Colombia. La participación es voluntaria y busca evaluar el flujo de revisión y propuesta de cambios sobre modelos autorizados.</p>
    <h2>Uso de archivos y cambios</h2>
    <p>Usa planos, modelos y fichas que tengas autorización para compartir. La profesional revisa los cambios propuestos y decide si los aplica. Las imágenes generadas con IA sirven para explorar ideas. Consulta el modelo y sus propiedades para verificar medidas y geometría.</p>
    <h2>Retiro y contacto</h2>
    <p>Puedes detener tu participación y solicitar el retiro de tus datos escribiendo a <a href="mailto:obracota03@gmail.com">obracota03@gmail.com</a>. La <Link href="/privacidad">política de privacidad del piloto</Link> describe los plazos y el procedimiento.</p>
    <p className="pilot-note">Fechas del piloto y mecanismo para registrar la aceptación <strong>[Por confirmar]</strong>.</p>
  </article>;
}
