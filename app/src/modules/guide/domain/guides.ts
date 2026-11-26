export interface GuideStep { title: string; text: string }
export interface Guide {
  slug: string;
  title: string;
  summary: string;
  /** Where the guide is practised. */
  place: string;
  steps: readonly GuideStep[];
  /** Present when the application can walk the user through it. */
  practice?: { href: string; label: string };
}

const VIEWER = "/proyectos/restage/visor";

export const guides: readonly Guide[] = [
  {
    slug: "primeros-pasos", title: "Empieza por aquí",
    summary: "Lo esencial en tres pasos: elegir una pieza, editarla y recorrer el modelo.",
    place: "Visor del proyecto de ejemplo",
    practice: { href: VIEWER + "?guia=rapida", label: "Hacer el recorrido rápido" },
    steps: [
      { title: "Elige una pieza", text: "Despliega el panel de piezas y pulsa una de la lista, o tócala en el modelo. Verás su clase, su nivel y su material." },
      { title: "Pulsa «Editar»", text: "Editar marca piezas o zonas del modelo para describir un cambio, o cambia la hora, el entorno o el estilo de toda la vista." },
      { title: "Recórrelo por dentro", text: "Camina por el modelo en primera persona para anticipar problemas antes de la obra. El recorrido aparece al abrir un IFC guardado en uno de tus proyectos." },
    ],
  },
  {
    slug: "pedir-opciones", title: "Pedir opciones visuales",
    summary: "Describe el cambio con opciones cerradas y revisa el texto y el costo antes de enviarlo.",
    place: "Visor de una versión guardada",
    steps: [
      { title: "Pulsa «Renderizar»", text: "Se abre el panel de opciones visuales de la pieza elegida o, sin pieza, de toda la vista. Al enviar se usa el encuadre que ves en pantalla." },
      { title: "Elige qué quieres probar", text: "Marca acabado o material, tono, luz del día y qué conservar. También puedes escribir el cambio con tus palabras." },
      { title: "Lee «Se enviará:»", text: "Es el texto exacto que recibirá el modelo de imagen. Si algo no encaja, cambia las opciones antes de enviar." },
      { title: "Revisa el costo en el botón", text: "El botón muestra la reserva de la petición y debajo queda el saldo mensual de IA. Nada se cobra sin que lo envíes." },
      { title: "Recibe tres propuestas", text: "Las imágenes llegan rotuladas como «Generado con IA»: sirven para decidir, no para medir." },
    ],
  },
  {
    slug: "marcar-area", title: "Marcar piezas y zonas",
    summary: "Di «cambia solo esto» señalándolo en el modelo, con una nota por marca.",
    place: "Editar, en una versión guardada",
    steps: [
      { title: "Pulsa «Editar»", text: "Aparece una barra encima con Seleccionar ya activo. Puedes poner hasta cinco marcas." },
      { title: "Haz clic o arrastra", text: "Un clic sobre una pieza la marca con un número que la sigue al girar la cámara. Un arrastre marca una zona del encuadre. Para girar mientras marcas, usa el botón derecho." },
      { title: "Describe el cambio", text: "Cada marca abre un campo «Describe el cambio aquí». Pulsa el número para volver a él; la papelera quita la marca." },
      { title: "O hazlo con teclado", text: "Tab llega a las marcas: Intro abre su campo, Supr la quita y las flechas la mueven. «Añadir marca en el centro» aparece al recorrer la barra con Tab." },
      { title: "Envía la edición", text: "Encima de la barra verás cuánto reserva el envío del presupuesto de IA. La flecha envía y las tres opciones aparecen en Renderizar." },
    ],
  },
  {
    slug: "comparar-opciones", title: "Comparar una opción",
    summary: "Enfrenta la captura del modelo con una propuesta usando un divisor.",
    place: "Renderizar, con propuestas listas",
    steps: [
      { title: "Pulsa «Comparar»", text: "El botón está junto a Descargar, al final de la barra. Se abre la captura original a la izquierda y la propuesta a la derecha." },
      { title: "Mueve el divisor", text: "Arrástralo o usa las flechas del teclado para descubrir más de una imagen o de la otra." },
      { title: "Decide y cierra", text: "La imagen de la derecha está generada con IA. La decisión de aplicar el cambio al modelo es tuya." },
    ],
  },
  {
    slug: "descargar-opcion", title: "Descargar una opción",
    summary: "Ajusta nitidez, brillo, calidez y saturación y guarda la imagen como PNG.",
    place: "Renderizar, con propuestas listas",
    steps: [
      { title: "Pulsa «Descargar»", text: "Se abre la imagen con cuatro ajustes: nitidez, brillo, calidez y saturación." },
      { title: "Ajusta a la vista", text: "Cada control muestra su valor. «Restablecer» devuelve la imagen a como llegó." },
      { title: "Descarga la imagen", text: "El archivo es un PNG con el nombre de la pieza y el número de opción, y conserva la marca «Generado con IA»." },
    ],
  },
  {
    slug: "recorrer", title: "Recorrer en primera persona",
    summary: "Entra al modelo y camínalo para comparar la versión anterior con la nueva.",
    place: "Visor, con un IFC guardado en uno de tus proyectos",
    steps: [
      { title: "Pulsa «Recorrido»", text: "El botón se activa cuando el modelo abierto se puede recorrer." },
      { title: "Elige dónde empezar", text: "Marca un punto libre en el piso. Con Intro se prueba el centro." },
      { title: "Camina y mira", text: "Arrastra para mirar y usa WASD o las flechas para caminar; mantén Mayús para correr. Con Esc sales del recorrido." },
    ],
  },
  {
    slug: "revisar-entrega", title: "Revisar una entrega",
    summary: "Define qué revisar, busca en el archivo y deja tus observaciones.",
    place: "Visor",
    steps: [
      { title: "Define qué revisar", text: "Abre «Revisar entrega» y escribe qué quieres comprobar en el archivo." },
      { title: "Busca en el archivo", text: "Usa el buscador para localizar piezas o textos del plano." },
      { title: "Anota qué revisarías", text: "Deja una observación ubicada. Aparecerá en el resultado de la revisión." },
    ],
  },
];

export function findGuide(slug: string): Guide | undefined { return guides.find(guide => guide.slug === slug); }
