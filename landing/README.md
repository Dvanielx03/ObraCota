# ObraCota · landing «Precisión»

Landing de ObraCota («Del terreno a la obra»). Su objetivo es uno solo: que un ingeniero o
diseñador entienda qué hace el producto y solicite una demostración.

> ObraCota es un proyecto académico en fase de definición. Avance usa fechas de terminación de ReStage. El formulario valida y
> confirma, pero **no envía datos**. El modelo 3D sí es un edificio real, con su fuente y
> licencia indicadas más abajo.

## Tecnologías

| Para qué | Con qué |
|---|---|
| Aplicación | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Estilos | Tailwind CSS 4, componentes de shadcn/ui sobre Base UI, iconos Phosphor |
| Movimiento | Lenis para el scroll suave, GSAP 3 con ScrollTrigger y `@gsap/react` |
| Modelo 3D | three.js en el navegador; `web-ifc` y glTF-Transform para convertir el IFC |
| Pruebas | Playwright (`@playwright/test`) con el Microsoft Edge instalado |

Tipografías: Bebas Neue en titulares y Manrope en el texto, alojadas por `next/font`.

## Comandos

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run test:e2e
```

Las pruebas compilan el sitio, lo sirven en el puerto 3100 y lo recorren en escritorio
(1440 × 900) y móvil (Pixel 7). `node scripts/capturas.mjs` guarda capturas por sección en
`test-results/capturas/` para revisión visual.

Para probar un servidor ya abierto, sin compilar:

```bash
SITIO_EN_MARCHA=http://localhost:3002 npx playwright test
```

`node scripts/capturas-recorrido.mjs [url] [carpeta]` guarda el recorrido 3D en varios puntos
del scroll, en escritorio y móvil.

## Estructura

```
src/app/                  páginas: inicio, /privacidad, 404, metadatos e icono
src/components/site/      header fijo en píldora, pie y marca
src/components/sections/  portada, recorrido 3D (con su entrada), expediente, avance y contacto
src/components/sections/recorrido/
  entrada.tsx             la «O» de PLANO: zoom por la letra hasta el modelo
  coreografia.ts          avance del scroll -> cámara, despiece, transparencia e hitos
  visor.ts                escena three.js: dibuja el estado que le da la coreografía
  secuencia.ts            hitos o programación real del IFC (o un orden ilustrativo)
src/components/site/scroll-suave.tsx   Lenis sobre el reloj de GSAP
src/lib/caso.ts           datos del caso de muestra (Pabellón Arrayán)
src/lib/modelo/           ficha del modelo, créditos y traducción de las tareas
scripts/ifc-a-glb.mjs     conversor de IFC a GLB por nivel, sistema y ventana de obra
scripts/perfiles/         reglas propias de cada edificio (niveles, sistemas, exclusiones)
scripts/explorar-ifc.mjs  inventario de un IFC antes de convertirlo
scripts/inspeccionar-ifc.mjs  niveles, materiales, tareas y caja de cada elemento, en JSON
tests/                    pruebas de extremo a extremo
```

## Movimiento

- **Scroll.** Lenis suaviza el scroll y avanza con el reloj de GSAP (`gsap.ticker`), de modo
  que ScrollTrigger y el visor leen la misma posición en el mismo cuadro. No hay otro bucle
  de animación: el visor solo dibuja cuando cambia su estado.
- **Entrada al recorrido.** La frase del producto termina en un gran «PLANO». El scroll
  acerca la cámara hasta cruzar el hueco de la «O»; dentro está el edificio dibujado solo
  en líneas sobre papel, y al llenar la pantalla las líneas se rellenan y empieza el
  recorrido. Ocupa las dos primeras pantallas del tramo fijado (1,7 en móvil). Las letras
  son texto SVG y el zoom cambia su `viewBox`, así que no se pixelan. El «plano» es el
  mismo modelo 3D con los rellenos apagados. Está en `recorrido/entrada.tsx`. Con
  movimiento reducido no hay zoom: la frase se lee de una pieza sobre el recorrido.
- **Momento central.** En «El modelo, pieza por pieza» la pantalla se fija y un único número
  (el avance del scroll, de 0 a 1) decide cámara, punto de mira, separación de plantas,
  transparencia, textos e hitos. Está en `recorrido/coreografia.ts`. Al volver atrás se
  recorren los mismos encuadres.

| Tramo | Qué pasa |
|---|---|
| 0–20 % · Reconocer | Vista a tres cuartos por la cara abierta; la cámara se desplaza a un lateral |
| 20–42 % · Separar | Cimentación, planta baja, planta alta y cubierta se separan |
| 42–66 % · Entrar | Las plantas se cierran, la cámara llega junto a la viga, cruza el vano y se detiene bajo el nudo |
| 66–90 % · Comprender la estructura | Lo no estructural se vuelve transparente; la cámara recorre la crujía y sale entre dos montantes |
| 90–100 % · Reconstruir en el tiempo | Vista exterior quieta; el edificio aparece por hitos reales y el control queda libre |

- **Portada.** El edificio se levanta con el scroll, del terreno a la obra terminada. La
  sección se queda fija (CSS `position: sticky`, sin fijado de ScrollTrigger) durante 2,4
  pantallas en móvil y 2,8 en escritorio. Debajo hay tres fotos que se funden según el
  avance; encima, dos clips cuyo `currentTime` sigue al scroll. En las tres paradas se ve
  la foto nítida y el vídeo solo aparece entre una y otra. Está en `sections/hero-fondo.tsx`.
- **Expediente.** Planta baja y planta alta de ReStage, con el mismo encuadre para comparar. `node scripts/plantas-restage.mjs` proyecta aristas de estructura y cerramientos y secciona los triángulos de `public/modelos/restage.glb` a 1,20 m sobre las bases de los dos niveles de la ficha. Produce dos SVG estáticos; son vistas derivadas del modelo, sin número de lámina o revisión original. El scroll revela el dibujo y «Ampliar plano» abre la vista seleccionada con sus créditos.
- **Avance.** Carrusel automático con los ocho hitos que el IFC de ReStage registra como terminados. La imagen ocupa las columnas 5 a 12; a la izquierda van el número de hito, su nombre, la fecha, el nombre original con su número de piezas y una silueta del edificio con esas piezas en ámbar. Cada vista dura unos 6 s con un acercamiento lento y la siguiente se abre desde el centro; el riel se llena en ámbar. De la última a la primera no se rebobina: el riel se vacía y la imagen pasa por tinta. Se detiene con el puntero encima, con foco de teclado, al tocar, fuera de pantalla y con el botón de pausa; con movimiento reducido no avanza solo. Las imágenes (`public/images/avance/h1…h8.webp`) son recreaciones con IA sobre renders del modelo terminado con la misma cámara, y la página lo rotula.
- **Movimiento reducido:** sin Lenis ni pantalla fijada. Las mismas cinco vistas se eligen
  con botones y cambian al instante.
- **Vídeo de la portada.** Se pide solo si la portada está en pantalla, después de cargar
  la página, de uno en uno y desde memoria. No se descarga con ahorro de datos, con menos
  de 4 GB de memoria o menos de 4 núcleos: entonces se ven las fotos fundiéndose.

## Modelo 3D

**Edificio:** ReStage, un demostrador construido en el campus Melaten de RWTH Aachen
(Alemania): pórticos de acero, un volumen de madera y muros de concreto en planta baja.

**Fuente:** <https://zenodo.org/records/21470658>. Creadores según el depósito: Chu Han Wu,
Görkem Can Ertemli, Martin von Hilchen, Sigrid Brell-Cokcan y Marit Zöcklein. Archivo usado:
`Restage_IP_ALL_MULTI_001.ifc` (IFC4, 189,8 MB, exportado desde cadwork).

**Licencia:** Creative Commons Atribución 4.0 (CC BY 4.0). La página acredita a los autores,
enlaza la licencia e indica los cambios hechos.

La investigación de candidatos está en `modelos-fuente/candidatos/seleccion.md`. El modelo
anterior (Schependomlaan) sigue en `public/modelos/edificio.glb` y el conversor lo produce
igual que antes, pero la página ya no lo carga.

### Conversión

```bash
node scripts/ifc-a-glb.mjs modelos-fuente/candidatos/restage/Restage_IP_ALL_MULTI_001.ifc public/modelos restage --perfil=scripts/perfiles/restage.mjs
```

Después se copia `public/modelos/restage.json` a `src/lib/modelo/ficha-restage.json`. El IFC
no se versiona. Resultado: 3.793 elementos, 416.530 triángulos y un GLB de 1,99 MB (el IFC
trae 1,6 millones de triángulos sin contar el entorno).

Lo que decide `scripts/perfiles/restage.mjs`, porque el archivo no lo trae resuelto:

- **Plantas.** Los 12 `IfcBuildingStorey` son paquetes por material y módulo (Concrete_00,
  Steel_01, Timber_02…), varios a la misma cota. Las cuatro plantas físicas se recuperan por
  la cota de base: cimentación, planta baja (desde 0,30 m), planta alta (desde 2,72 m) y
  cubierta (desde 5,10 m). Las piezas de un mismo `IfcElementAssembly` comparten planta, así
  una columna continua viaja con sus tramos soldados. Las piezas que cruzan varias plantas
  (columnas de 4,92 m, muros de madera de 7 m) se quedan en la planta donde arrancan.
- **Materiales.** Se agrupa por el material declarado en el IFC: acero (STEEL/S235JR,
  S355J2+N, 8.8, 10.9…), madera (CLT, GL24h, KVH, LIGNO, 3S…) y concreto (C25/30, C35/45).
  1.663 piezas no declaran material; esas toman el del paquete al que pertenecen
  (`Steel_*`, `Timber_*`, `Concrete_*`). La tornillería y las soldaduras van aparte
  (`uniones`), igual que la malla de refuerzo.
- **Exclusión.** Se omite el entorno del campus: terreno, cerca, 24 contenedores, dos
  escaleras exteriores y dos toldos. Son los 41 objetos sin planta ni tarea.
- **Simplificación.** Malla de refuerzo al 8 %, tornillería al 45 %, instalaciones al 20 %,
  fachada y cubierta al 50 %. Estructura, madera, concreto y el detalle no se tocan.
- **Detalle protagonista.** El nudo superior del pórtico posterior: la viga
  `STL1-01-BEAM-HEB` (acero S235JR, 1,90 m), el tramo corto soldado a la columna, la columna
  continua y la unión (dos placas S355J2+N, tornillería de 12 mm grado 10.9 y seis
  soldaduras). Se localiza por posición y la ficha guarda el `GlobalId` de cada pieza en
  `destacados`.

### Hitos (4D)

El IFC trae 12 `IfcTask`, 12 `IfcTaskTime` y 4.262 `IfcRelAssignsToProduct`. Once tareas
tienen fecha real de terminación (`ActualFinish`) y ninguna tiene comienzo ni duración. El
conversor lee ese caso aparte y no toca el de Schependomlaan.

- **Ocho hitos.** Tres parejas de tareas comparten fecha y elementos (por ejemplo
  `ConstructionPhase_01` y `Bauabschnitt_01`): se muestran como un hito con sus dos nombres.
  Van del 26 de agosto de 2024 al 25 de agosto de 2025.
- **Sin interpolar.** La línea avanza de hito en hito, no es una escala de días. Cada
  conjunto aparece al llegar a su fecha y queda resaltado hasta el siguiente. El fundido
  entre un hito y otro es solo visual.
- **Tarea sin fecha.** `ConstructionPhase_02` no tiene fecha ni elementos propios: es el
  grupo de cuatro hitos que sí la tienen. No se muestra como hito.
- **Piezas sin vínculo.** Las 3.793 piezas del edificio tienen hito. Las 41 sin tarea son
  el entorno excluido.
- Los nombres de los hitos se traducen del inglés en `recorrido/secuencia.ts`; el nombre
  original se muestra siempre.

## Portada: imágenes y vídeo

Las tres fotos (`public/images/portada-*.jpg`, 2752 × 1536) y los dos clips
(`public/video/portada-*.mp4`) son una **recreación hecha con IA** (Higgsfield: Nano Banana 2
y Seedance 2.0) a partir de capturas del modelo real de ReStage. La página lo rotula. El
paisaje es inventado y el estado intermedio (acero sin madera) no es un hito del IFC.

```bash
node scripts/codificar-video.mjs <clip.mp4> portada-1
```

Codifica en H.264 con un fotograma clave cada 6 cuadros (para buscar hacia delante y hacia
atrás sin tirones), sin audio, en 1280 y 960 px de ancho. Los cuatro archivos pesan
7,2 MB; cada visita descarga solo dos (4,9 MB en escritorio, 2,2 MB en móvil).

- Los clips son de 720p: es el máximo de la prueba gratuita con que se generaron.
- El final del primer clip y el inicio del segundo no coinciden al píxel (24 dB). La foto
  de la parada central tapa esa costura con un fundido de 0,3 s.

## Créditos

- Modelo 3D e hitos: ReStage, RWTH Aachen, CC BY 4.0 (ver arriba).
- Portada y avance: recreaciones con IA (Higgsfield) a partir del modelo de ReStage.
- Fotografía del contacto: imagen generada con Google Flow para el caso ficticio Pabellón
  Arrayán. Pendiente de sustituir por el mismo edificio.

## Pendientes conocidos

- Conectar el formulario a un canal de contacto real y redactar la política de datos.
- Rehacer la foto de contacto y la imagen para redes (`og.jpg`) con el mismo edificio.
- Probar el vídeo ligado al scroll en un iPhone real.
- En el servidor de desarrollo, las pruebas que entran directo a una sección pueden fallar por hacer clic antes de la hidratación; contra la compilación de producción pasan.
- Definir el dominio (`NEXT_PUBLIC_SITE_URL`) antes de publicar.
- Medir el recorrido en un teléfono real: las pruebas usan un navegador de escritorio con tamaño de móvil.
- A la salida del tramo 04 la cámara pasa a 27 cm de dos montantes de la fachada; no los atraviesa, pero el encuadre queda apretado un instante.
