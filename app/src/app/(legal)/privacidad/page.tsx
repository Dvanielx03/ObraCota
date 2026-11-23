import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacidad del piloto · ObraCota", robots: { index: false, follow: false } };

export default function PrivacyPage() {
  return <article>
    <p className="pilot-note">Piloto privado · Borrador para revisión</p>
    <h1>Privacidad del piloto</h1>
    <h2>Responsable del tratamiento</h2>
    <p>Daniel Santiago Mayorga, persona natural y estudiante a cargo del proyecto académico ObraCota en Colombia. El canal para solicitudes es <a href="mailto:obracota03@gmail.com">obracota03@gmail.com</a>.</p>
    <p className="pilot-note">Domicilio y dirección <strong>[Por confirmar]</strong>. Teléfono de contacto <strong>[Por confirmar]</strong>.</p>
    <h2>Datos y finalidades</h2>
    <p>ObraCota usa el correo y los datos de acceso para gestionar la cuenta. Guarda los archivos que decidas subir, sus versiones, las fichas vinculadas y las propuestas para operar el panel y evaluar el piloto. Los modelos abiertos solo de forma local se procesan en el navegador.</p>
    <p>Las funciones opcionales de IA pueden compartir con el proveedor configurado la captura, la descripción del cambio, la máscara o los fragmentos de una ficha necesarios para responder. Proveedores habilitados en el piloto <strong>[Por confirmar]</strong>.</p>
    <h2>Plazos de conservación</h2>
    <ul>
      <li>Cuentas y modelos subidos. Hasta 30 días después de terminar el piloto, o antes si lo solicita la persona participante.</li>
      <li>Registros técnicos y diario del agente de IA. Hasta 90 días.</li>
      <li>Respaldos. Se sobrescriben en 30 días.</li>
    </ul>
    <p>Al vencer el plazo aplicable se eliminan los datos activos. Las copias de respaldo que aún los contengan expiran con su rotación. La ejecución de este procedimiento se verificará antes de iniciar el piloto.</p>
    <h2>Consultas y reclamos</h2>
    <p>Escribe al correo del proyecto para acceder a tus datos, solicitarlos, actualizarlos, corregirlos, pedir su supresión o revocar la autorización. Indica qué necesitas y un medio para responder.</p>
    <ul>
      <li>Consultas. Diez días hábiles desde el recibo. Ante una demora se informan los motivos y la nueva fecha, que se fija como máximo cinco días hábiles después del plazo inicial.</li>
      <li>Reclamos. Quince días hábiles desde el día siguiente al recibo del reclamo completo. Ante una demora se informan los motivos y la nueva fecha, que se fija como máximo ocho días hábiles después del plazo inicial.</li>
    </ul>
    <p>Tras agotar el trámite ante el responsable, puedes acudir a la Superintendencia de Industria y Comercio.</p>
    <p>Marco aplicable <a href="https://www.cancilleria.gov.co/normograma/compilacion/docs/ley_1581_2012.htm">Ley 1581 de 2012</a> y <a href="https://cancilleria.gov.co/sites/default/files/Normograma/docs/decreto_1377_2013.htm">Decreto 1377 de 2013 y su compilación en el Decreto 1074 de 2015</a>.</p>
  </article>;
}
