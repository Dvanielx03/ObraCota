# ObraCota · Panel de proyectos

Desde la raíz, `docker compose up -d --build app` sirve el panel en http://localhost:3201. Para desarrollo, desde esta carpeta, ejecutar `npm ci` y `npm run dev`. La instalación copia el lector web-ifc y su WASM a un directorio público generado.

Desde Propiedades, «Preguntar en el asistente del proyecto» abre la consulta documental de la pieza y revisión seleccionadas. El PDF se vincula en «Ficha técnica».

La ruta principal abre `/proyectos`. Desde el resumen público de ReStage se entra a archivos, cambios, asistente o al visor en `/proyectos/restage/visor`. Cuenta se encuentra en `/cuenta`. Registro e inicio de sesión permiten crear proyectos privados y consultarlos desde otro inicio de sesión. El navegador llama a /api en su propio origen. Next.js reenvía estas solicitudes al backend configurado con API_INTERNAL_URL al construir la imagen. El puerto de `viewer/domain` separa las acciones del usuario del adaptador three.js. El archivo abierto en el visor permanece en memoria. Cerrar el modelo o recargar libera esa vista. Las cuentas y proyectos se guardan en PostgreSQL.

**ReStage.** El ejemplo abre el GLB simplificado de la landing con su índice. La viga inicial muestra la selección sincronizada. Los conjuntos conservan su número de piezas. Las piezas individuales identificadas tienen GlobalId. La paleta del ejemplo representa sistemas constructivos. [Atribución](public/models/creditos.txt).

**Espacio de trabajo.** El visor de una versión tiene una cabecera flotante con el nombre del archivo, el tema (Claro → Oscuro → Sistema), Presentar y Exportar «Imágenes (ZIP)»; a la izquierda la tira de vistas guardadas con miniatura; a la derecha el riel de versiones (atajos 1–9), y abajo la barra RENDERIZAR · EDITAR · REVISAR · RECORRIDO │ Comparar · Descargar. Al entrar desde el panel, la pantalla de preparación se mantiene al menos 5 s.

**Formatos.** Se guardan versiones IFC, DWG, DXF, RVT, FBX y OBJ. El formulario lee los primeros 4096 bytes para comprobar la cabecera y el servidor repite la validación. FBX y OBJ se abren como mallas. Un RVT guardado puede descargarse con verificación SHA-256. Para consultar su geometría, abre un IFC exportado desde Revit o usa la traducción a IFC cuando Autodesk APS esté configurado.

**Cambios de modelo.** En `/proyectos/{id}/cambios` cada cambio muestra su receta, avisos, diferencias con la base y validación del archivo. «Ver propuesta en 3D» abre la vista previa verificada sin publicarla, con RECORRIDO Base/Propuesta y Comparar. «Aprobar y aplicar cambio» publica la revisión y «Crear revisión de restauración» vuelve a la base.

**Revisiones de plano.** En un DWG o DXF guardado, Editar marca la entidad bajo el clic (su handle) y «Proponer cambio al modelo» envía la nota al agente. El motor convierte el DWG a DXF con LibreDWG, aplica `dwg.set_text`, `dwg.set_layer`, `dwg.set_color`, `dwg.move` o `dwg.add_note` (nota con nube de revisión en la capa OBRACOTA-REVISION) con ezdxf, relee el resultado y compara cada entidad por handle. Al aprobar, la revisión se publica como `<original>-r<N>.dxf` en el mismo archivo; AutoCAD abre el DXF y puede guardarlo como DWG. Renderizar también trabaja sobre el plano.

**Modelos grandes.** Los cambios de propiedades y materiales se verifican en IFC de hasta 256 MiB: el motor compara la base y la revisión entidad por entidad y valida el esquema de lo que cambió. Los cambios de geometría siguen hasta 32 MiB.

**IFC.** Un worker procesa el archivo STEP con web-ifc y entrega mallas, transformaciones, colores e identidades al adaptador gráfico. La ficha muestra las relaciones directas de nivel y material que puede leer. En conversiones desde otro formato se cotejan esquema, medidas y piezas con el original. [Exportación desde AutoCAD Architecture](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Architecture/files/GUID-4636802F-2752-408C-A08F-148A83FAE005.htm)

**DWG.** Un worker local lee el espacio modelo con LibreDWG. Entrega geometría por capa a three.js y desplaza el origen antes del paso a Float32 para conservar precisión. La ficha muestra las unidades declaradas, el rango Z visible y las omisiones del lector. Lectura localiza capas, textos y cotas lineales o alineadas compatibles. En un DWG guardado, el servidor puede teselar sólidos ACIS admitidos. La fidelidad depende de las entidades del archivo. Las láminas de impresión y las referencias externas requieren comprobación en la herramienta de origen.

Se eligió el lector WASM por privacidad, ejecución local y compatibilidad con el puerto del visor. El paquete indica GPL-3.0; revisar las condiciones de distribución del frontend antes de publicarlo. Drawings SDK/inWEB de ODA es una alternativa comercial para evaluar si el flujo necesita fidelidad en sólidos propietarios. Una conversión asistida a IFC en la herramienta de autoría sigue siendo útil si se necesitan propiedades BIM. [Lector y código fuente](https://github.com/mlightcad/libredwg-web) · [Drawings SDK](https://www.opendesign.com/files/2024-10/Drawings%20Datasheet.pdf) 

**Recorrido.** WASD o flechas para caminar, Mayús para correr y arrastrar para mirar. El terreno de Revit (IfcSite), los revestimientos y las barandas son superficies del recorrido. Un acabado aprobado desde Renderizar se ve con la misma textura que su vista previa en el visor, en el recorrido y en la comparación Anterior/Nueva. Al localizar una pieza tapada, el visor la encuadra desde el lado que la ve y retira lo que queda delante hasta que se mueve la cámara.

**Navegación.** Rueda para acercar al cursor, botón central para desplazar, Mayús + botón central para orbitar sobre la geometría bajo el puntero. Doble clic central encuadra la extensión manteniendo la orientación. El cubo orienta las vistas y la tríada indica los ejes del dibujo. Zoom ventana amplía un rectángulo; Esc cancela. Inicio en el lienzo restablece la cámara. Se conservan los gestos táctiles, las herramientas existentes y el control por teclado. [Navegación de AutoCAD](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-GettingStarted/files/GUID-FFD36F14-5A5E-4DF3-86E9-4B811B158138.htm)

**Comprobaciones.** `npm run typecheck` verifica fuentes, configuración y pruebas sin depender de artefactos de compilaciones previas. `npm run build` comprueba también los tipos de rutas que genera Next.js. `npm run lint` ejecuta ESLint y `npm test` ejecuta Playwright.

**Pruebas.** Con el servidor activo, ejecutar `npx playwright test` con Microsoft Edge. Solo hay un proyecto de escritorio: la app no se adapta a móvil. `VIEWER_URL` cambia el servidor de destino y `LANDING_URL` el de la landing. Cuando un enlace de la landing apunta a otro origen, la prueba lo activa de verdad (clic o teclado), comprueba que navega a su `href` con una respuesta simulada y después abre la misma ruta en `VIEWER_URL`. Para `panel.spec.ts`, la app debe conocer la landing con `NEXT_PUBLIC_SITE_URL` igual a `LANDING_URL` (en desarrollo, en `.env.development.local`; en un `next build`, como variable de entorno al construir). El campo de subida de «Archivos y versiones» se localiza con `getByTestId("model-upload")`, no por su texto. Las pruebas que necesitan un archivo local se omiten si falta su variable:

| Variable | Qué habilita |
|---|---|
| `TEST_IFC` | IFC propio para el visor, la entrega y las versiones; la prueba de Editar con máscara exige el IFC completo de ReStage y falla con un mensaje claro si es otro |
| `RESTAGE_IFC` | IFC completo de ReStage para el recorrido (`walk.spec.ts`) y la visibilidad de «Ficha técnica» |
| `RAME_IFC` | Rame Tower para la ficha escaneada de `ficha-tecnica-rag.spec.ts` (por defecto, la copia de `landing/modelos-fuente`) |
| `DUPLEX_IFC` | Duplex A: cambios de modelo, vistas guardadas, edición y opciones |
| `DUPLEX_WIDER_IFC` | Variante del Duplex con una puerta más ancha (`door-evidence.spec.ts`) |
| `DUPLEX_DOOR_PDF` | Ficha PDF de la puerta para el asistente documental |
| `TEST_DWG`, `TEST_DWG_REVISION` | DWG 2D y una revisión del mismo archivo |
| `TEST_DWG_3D` | DWG con geometría visible a distintas cotas ([ejemplo](https://github.com/LibreDWG/libredwg/blob/master/test/test-data/2000/entities-3d.dwg)) |
| `BIMOBJECT_DIR` | Carpeta con DWG, FBX y OBJ de fabricante (`bimobject-dwg.spec.ts`, `fbx-obj.spec.ts`) |
| `TEST_LIVE_RAG=1` | Asistente documental con EmbeddingGemma y Qwen2.5 en Ollama local |
| `TEST_LIVE_GEMINI=1` | Opciones visuales contra Gemini real (gasta; requiere autorización) |
| `TEST_NO_GEMINI=1` | Opciones visuales contra un servidor sin clave de Gemini: comprueba el aviso y usa respuestas de ensayo |
| `TEST_HARDWARE_GPU=1` | Usa la gráfica del equipo en lugar de SwiftShader |
| `EVIDENCE_DIR` | Carpeta donde se guardan las capturas de evidencia |

Para probar el recorrido entre aplicaciones con Compose en marcha, desde esta carpeta ejecuta `npx playwright test tests/panel.spec.ts`. Las capturas se escriben en el directorio de resultados de Playwright.

Para la prueba documental, levanta el perfil `rag` y carga los modelos según [Arquitectura del backend](../backend/docs/ARCHITECTURE.md#asistente-documental). Con los archivos Duplex configurados, ejecuta `npx playwright test tests/document-index.spec.ts tests/document-assistant.spec.ts --workers=1`. La primera prueba crea un PDF de solo imagen y verifica OCR, autorización y citas sin conservar el PDF. `tests/ficha-tecnica-rag.spec.ts` cubre «Ficha técnica» en cualquier pieza IFC, el PDF digital y el escaneado, la discrepancia entre fichas, el texto con forma de instrucción y el aislamiento por cuenta, versión y pieza. Construye sus PDF con `tests/support/rag-pdf.ts`.
