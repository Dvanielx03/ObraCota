# ObraCota · Panel de proyectos

Desde la raíz, `docker compose up -d --build app` sirve el panel en http://localhost:3201. Para desarrollo, desde esta carpeta, ejecutar `npm ci` y `npm run dev`. La instalación copia el lector web-ifc y su WASM a un directorio público generado.

La ruta principal abre `/proyectos`. Desde el resumen público de ReStage se entra a archivos, cambios, asistente, presupuesto o al visor en `/proyectos/restage/visor`. Cuenta se encuentra en `/cuenta`. Registro e inicio de sesión permiten crear proyectos privados y consultarlos desde otro inicio de sesión. El navegador llama a /api en su propio origen. Next.js reenvía estas solicitudes al backend configurado con API_INTERNAL_URL al construir la imagen. El puerto de `viewer/domain` separa las acciones del usuario del adaptador three.js. El archivo abierto en el visor permanece en memoria. Cerrar el modelo o recargar libera esa vista. Las cuentas y proyectos se guardan en PostgreSQL.

**ReStage.** El ejemplo abre el GLB simplificado de la landing con su índice. La viga inicial muestra la selección sincronizada. Los conjuntos conservan su número de piezas. Las piezas individuales identificadas tienen GlobalId. La paleta del ejemplo representa sistemas constructivos. [Atribución](public/models/creditos.txt).

**Espacio de trabajo.** El visor de una versión tiene una cabecera flotante con el nombre del archivo, el tema (Claro → Oscuro → Sistema), Presentar y Exportar «Imágenes (ZIP)»; a la izquierda la tira de vistas guardadas con miniatura; a la derecha el riel de versiones (atajos 1–9), y abajo la barra RENDERIZAR · EDITAR · REVISAR · RECORRIDO │ Comparar · Descargar. Al entrar desde el panel, la pantalla de preparación se mantiene al menos 5 s.

**Formatos.** Se suben como versiones IFC, DWG, FBX y OBJ (`MODEL_EXTENSIONS` en `src/modules/model-file/domain/file-header.ts`). El formulario lee los primeros 4096 bytes y explica el problema si la cabecera no corresponde a la extensión; el servidor repite la comprobación. FBX y OBJ se abren como mallas, sin propiedades BIM.

**Cambios de modelo.** En `/proyectos/{id}/cambios` cada cambio muestra su receta, avisos, estimación, diferencias con la base y validación del archivo. «Ver propuesta en 3D» abre la vista previa verificada sin publicarla, con RECORRIDO Base/Propuesta y Comparar. «Aprobar y aplicar cambio» publica la revisión y «Crear revisión de restauración» vuelve a la base.

**Archivo propio.** Abrir un IFC STEP con geometría. Un worker procesa el archivo con web-ifc y entrega mallas, transformaciones, colores e identidades al adaptador gráfico. La lectura de nivel y material cubre relaciones directas con nombre. La ficha conserva las ausencias. Los DXF y RVT requieren una exportación previa compatible. El equipo debe comprobar el producto de Autodesk utilizado, el esquema y los objetos que sobreviven al intercambio. [Exportación desde AutoCAD Architecture](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-4636802F-2752-408C-A08F-148A83FAE005.htm).

**DWG.** Abrir el original desde el selector. Un worker local decodifica el binario con LibreDWG y transfiere buffers tipados por capa al adaptador de three.js. La transformación de coordenadas del dibujo al visor es (X, Z, −Y); el origen gráfico se desplaza antes del paso a Float32 para conservar precisión. Se conserva una unidad de dibujo por unidad de escena y se indica INSUNITS. La selección de DWG corresponde a conjuntos por capa. Hay soporte para líneas, polilíneas, arcos, círculos, elipses, puntos, caras 3D, mallas PFACE e inserciones simples resueltas. Las curvas se teselan. «Datos de importación» muestra el rango Z visible y las omisiones informadas por el lector y el adaptador. Lectura indexa TEXT y MTEXT, encuadra su punto de inserción y muestra el texto original. Las cotas dibujadas, las referencias externas y los sólidos ACIS requieren trabajo adicional: un DWG con sólidos ACIS muestra un aviso y, si existe, la miniatura guardada. Las observaciones se guardan por selección y versión en este navegador. Este visor sirve para exploración geométrica y no reproduce una lámina de impresión.

Se eligió el lector WASM por privacidad, ejecución local y compatibilidad con el puerto del visor. El paquete indica GPL-3.0; revisar las condiciones de distribución del frontend antes de publicarlo. Drawings SDK/inWEB de ODA es una alternativa comercial para evaluar si el flujo necesita fidelidad en sólidos propietarios. Una conversión asistida a IFC en la herramienta de autoría sigue siendo útil si se necesitan propiedades BIM. [Lector y código fuente](https://github.com/mlightcad/libredwg-web) · [Drawings SDK](https://www.opendesign.com/files/2024-10/Drawings%20Datasheet.pdf) 

**Navegación.** Rueda para acercar al cursor, botón central para desplazar, Mayús + botón central para orbitar sobre la geometría bajo el puntero. Doble clic central encuadra la extensión manteniendo la orientación. El cubo orienta las vistas y la tríada indica los ejes del dibujo. Zoom ventana amplía un rectángulo; Esc cancela. Inicio en el lienzo restablece la cámara. Se conservan los gestos táctiles, las herramientas existentes y el control por teclado. [Navegación de AutoCAD](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-GettingStarted/files/GUID-FFD36F14-5A5E-4DF3-86E9-4B811B158138.htm)

**Pruebas.** Con el servidor activo, ejecutar `npx playwright test` con Microsoft Edge. `VIEWER_URL` cambia el servidor de destino y `LANDING_URL` el de la landing. Las pruebas que necesitan un archivo local se omiten si falta su variable:

| Variable | Qué habilita |
|---|---|
| `TEST_IFC` | IFC propio para el visor, la entrega y las versiones |
| `RESTAGE_IFC` | IFC completo de ReStage para el recorrido (`walk.spec.ts`) |
| `DUPLEX_IFC` | Duplex A: cambios de modelo, vistas guardadas, edición y opciones |
| `DUPLEX_WIDER_IFC` | Variante del Duplex con una puerta más ancha (`door-evidence.spec.ts`) |
| `DUPLEX_DOOR_PDF` | Ficha PDF de la puerta para el asistente documental |
| `TEST_DWG`, `TEST_DWG_REVISION` | DWG 2D y una revisión del mismo archivo |
| `TEST_DWG_3D` | DWG con geometría visible a distintas cotas ([ejemplo](https://github.com/LibreDWG/libredwg/blob/master/test/test-data/2000/entities-3d.dwg)) |
| `BIMOBJECT_DIR` | Carpeta con DWG, FBX y OBJ de fabricante (`bimobject-dwg.spec.ts`, `fbx-obj.spec.ts`) |
| `TEST_LIVE_RAG=1` | Asistente documental contra Gemini real (gasta; requiere autorización) |
| `TEST_LIVE_GEMINI=1` | Opciones visuales contra Gemini real (gasta; requiere autorización) |
| `TEST_NO_GEMINI=1` | Opciones visuales sin clave, con respuestas de ensayo |
| `TEST_HARDWARE_GPU=1` | Usa la gráfica del equipo en lugar de SwiftShader |
| `EVIDENCE_DIR` | Carpeta donde se guardan las capturas de evidencia |

Para probar el recorrido entre aplicaciones con Compose en marcha, desde esta carpeta ejecuta `npx playwright test tests/panel.spec.ts`. Las capturas se escriben en el directorio de resultados de Playwright.
