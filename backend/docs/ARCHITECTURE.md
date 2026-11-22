# Arquitectura del backend

Java 21, Spring Boot 3.5.16, Maven y PostgreSQL. `domain` define modelos y puertos. `application` coordina casos de uso en Java puro. `infrastructure` ensambla Spring, expone REST y adapta los puertos a JPA. Flyway administra el esquema y Hibernate lo valida al arrancar.

## Seguridad

`POST /api/auth/register`, `login`, `refresh` y `logout` operan bajo la misma ruta base. Registro e inicio reciben correo y contraseña. El token de acceso se envía como Bearer y se guarda en memoria en el navegador. La cookie HttpOnly SameSite=Strict contiene el JWT de refresco, limitado a /api/auth. Cada solicitud de autenticación requiere la cabecera X-ObraCota-Client=web. La aplicación utiliza el mismo origen mediante un proxy de Next.js. No hay CORS abierto.

PostgreSQL conserva la contraseña con BCrypt y el identificador de la sesión actual. El refresco rota el identificador de token en una actualización condicional. El cierre revoca la sesión y descarta la cookie. Cada solicitud privada comprueba la firma, el tipo de token, su vencimiento y la vigencia de la sesión. Usar HTTPS y COOKIE_SECURE=true al desplegar fuera del entorno local.

## Proyectos

`POST /api/projects` crea un proyecto y devuelve 201 con Location. `GET /api/projects` lista únicamente las obras del propietario. `GET`, `PUT` y `DELETE /api/projects/{id}` consultan, renombran y eliminan una obra del mismo usuario. La API responde 404 cuando la obra no es visible para el solicitante. El proyecto público de ejemplo pertenece al catálogo estático de la interfaz.

El agregado Project registra eventos de alta, cambio y eliminación. El caso de uso persiste mediante ProjectRepository, publica los eventos y los limpia en la misma transacción de entrada. Los futuros consumidores deben usar TransactionalEventListener en fase AFTER_COMMIT. Flyway conserva el vínculo con el propietario y su índice. La API prueba validación, persistencia, aislamiento de propietarios, mapeo sin repetir eventos y revocación de sesiones.

## Archivos del proyecto

ModelFile agrupa las entregas de un IFC o DWG por proyecto. El catálogo comprueba el propietario. Un identificador explícito permite asociar una revisión cuyo nombre ha cambiado.

Una entrega entra como flujo binario en `POST /api/projects/{project}/uploads?name=...`. El parámetro opcional `file` identifica un archivo ya catalogado. El servicio valida extensión y cabecera, calcula SHA-256 y cuenta los bytes durante la escritura. El máximo por original es 256 MiB. Las revisiones se numeran bajo bloqueo del proyecto. El volumen Docker `modelos-originales` contiene una ruta exclusiva por proyecto y versión. Un rollback elimina el original de la transacción. Al respaldar o restaurar, coordinar el volumen y PostgreSQL. Una interrupción del proceso durante la escritura puede dejar un original huérfano.

El visor descarga el original autenticado y lo procesa con el mismo lector que utiliza para archivos locales. Abrir localmente mantiene la privacidad del archivo. Al abrir la versión subida se pueden importar explícitamente las observaciones locales de esa misma huella. Las observaciones de otra revisión se consultan abriendo esa revisión.

## Opciones visuales

En una versión 3D del servidor, seleccionar una pieza y abrir **Propiedades → Opciones visuales**. El visor captura únicamente el lienzo. La ingeniera puede ver esa captura antes de enviarla. `GEMINI_API_KEY` se lee en el backend. Al faltar la clave se mantiene la lectura de las opciones anteriores.

El backend persiste la petición y la captura JPEG, limita su tamaño a 1.280 píxeles por lado y devuelve 202. Un trabajador reclama la petición, redacta tres variantes mediante el puerto de chat y solicita cada edición sobre la misma captura mediante el puerto de imagen. El diario registra los contadores que entrega Google. Si faltan, se muestran como desconocidos. El sistema conserva las opciones parciales y exige las tres antes de habilitar la elección. Evita reintentar automáticamente llamadas de resultado incierto. Una petición de generación tiene identificador idempotente. La política de presupuesto reserva 100 centavos de USD por terna admitida, incluidos fallos, de un saldo mensual global en UTC (`AI_MONTHLY_LIMIT_CENTS`, por defecto 1000). El consumo en tokens procede del proveedor; la reserva es una regla de admisión local.

El paso de una imagen elegida a un cambio IFC requiere una propuesta posterior con la versión base, GlobalId, tipo IFC de catálogo y parámetros en unidades verificadas. Para una puerta se contrastan tipo, giro, ancho, alto y hueco en el IFC. La ingeniera revisa y acepta esos valores antes de crear una versión derivada. La opción y su texto quedan como referencia visual. Una alternativa sin equivalente en el catálogo debe remitirse a modelado manual.

Para repetir las pruebas, la construcción de Docker ejecuta Maven, incluido el flujo con adaptadores de ensayo y la prueba HTTP del adaptador de imagen. Con el panel levantado, ejecutar en `app/` el test `npx playwright test visual-options.spec.ts` definiendo `TEST_IFC` y, si falta la clave, `TEST_NO_GEMINI=1`. El navegador comprueba la captura real y utiliza respuestas de ensayo para recorrer la elección sin coste.

## Asistente documental

El asistente de cada proyecto consulta una ficha PDF vinculada a una versión y un elemento. La consulta requiere autenticación y el backend comprueba la pertenencia de la ficha al proyecto antes de recuperar sus páginas. La carga de un PDF extrae el texto localmente. La primera pregunta autoriza el envío de la pregunta y fragmentos de esa ficha al proveedor.

El backend divide las páginas en pasajes de 1.400 caracteres con 200 de solapamiento. Por consulta indexa como máximo 16 pasajes pendientes, priorizados por coincidencia léxica. Almacena sus vectores de 768 dimensiones junto con el modelo de embeddings. PostgreSQL combina el rango léxico de los pasajes y el de distancia coseno de los vectores disponibles mediante fusión recíproca. La consulta vectorial opera sobre los pasajes del documento seleccionado. Una ficha extensa puede tener cobertura semántica parcial en sus primeras consultas. Si Gemini falla al generar embeddings, sigue disponible la recuperación por palabras.

Gemini recibe hasta seis pasajes. La aplicación acepta una respuesta si lleva una cita que puede localizar literalmente en uno de esos pasajes y en la página indicada. La ingeniera puede abrir la página y contrastar la interpretación o localizar la pieza en el visor. El historial conserva pregunta, respuesta y cita por ficha. Un escaneo sin texto requiere una versión con texto extraíble.

La reserva administrativa es de cinco centavos de USD por consulta admitida, compartiendo el saldo mensual global con las opciones visuales. El diario registra cada llamada y el consumo disponible. Una reserva no es una medición de facturación. La prueba `document-assistant.spec.ts` usa `TEST_LIVE_RAG=1`, `DUPLEX_IFC` y `DUPLEX_DOOR_PDF` para verificar el servicio real.

## Cambios de modelo

`ModelChange` generaliza el antiguo cambio de puerta. La migración V15 crea `model_change`, `model_change_event`, `unit_price` y `agent_tool_call`, copia el historial de `door_change` con los mismos identificadores y pasa a `DRAFT` los cambios que no se aplicaron. `door_change` y `door_unit_price` quedan intactas para poder volver al backend anterior; V16 las borrará cuando el stack principal esté actualizado. Las tablas nuevas usan JdbcTemplate, sin JPA, y la receta y el informe se guardan como texto JSON.

`/api/projects/{project}/model-changes` crea un borrador sobre la última versión IFC de un archivo y añade, cambia o quita operaciones (`/operations`). `POST /{id}/preview` pide al motor la vista previa, `submit` la envía a aprobación, `discard` la descarta o rechaza, y `apply` y `restore` publican. `GET /{id}/preview` descarga el IFC sin publicar. `/versions/{version}/summary`, `/elements` y `/elements/{guid}` leen el modelo desde el motor, y `/versions/{version}/prices` lee, reemplaza y copia precios. Cada respuesta de un cambio trae sus `actions` con el motivo cuando una acción no está disponible.

Los casos de uso están separados por lo que pueden hacer. `ModelChanges` y `ModelReading` son clases `final` que no exponen `ProjectVersions` ni el almacenamiento, para que el catálogo de herramientas del agente (H4) no llegue a publicar por un atajo. `PublishModelChange` y `VersionPrices` rechazan cualquier `Actor` que no sea una persona. `ActorArgumentResolver` entrega el `Actor` a todos los controladores desde la credencial autenticada. En la URL, `SecurityConfig` exige la autoridad de sesión de persona para aplicar, restaurar y fijar o copiar precios, y `AgentScope` limita la credencial de agente a los cambios de su proyecto. Un token de agente vive como máximo 15 minutos.

El motor IfcOpenShell corre detrás de `ModelEnginePort`, por la red privada de Compose, y lee el volumen de originales en modo de solo lectura. Valida la receta, la construye sobre una copia, la reabre y verifica esquema, malla, medidas, colocación, hueco y anfitrión. Compara la salida con la base mediante IfcDiff y un control propio de huecos. Guarda en caché por SHA-256 hasta `ENGINE_CACHE_MODELS` modelos abiertos y rechaza con 422 `MODEL_TOO_LARGE` lo que pase de `ENGINE_PREVIEW_MAX_BYTES` (32 MiB). Los plazos se encadenan: motor 150 s, `ifc.engine.preview-timeout` 180 s y `experimental.proxyTimeout` de Next.js 240 s. Las lecturas esperan 60 s.

El backend guarda el IFC verificado en `${models.directory}/.previews/{project}/{change}/{preview_id}.ifc`, escrito primero como `.part` y movido de forma atómica. Aprobar sube esos bytes como revisión nueva y comprueba que el SHA-256 coincide con el del informe; si no, revierte y borra el original. Ni aplicar ni restaurar llaman al motor. Restaurar crea una revisión con el SHA-256 de la base. Al aprobar se borran las vistas previas de los otros borradores del mismo archivo. `PreviewSweeper` borra cada hora los huérfanos, los `.part` viejos y las vistas previas de borradores sin actividad en 24 horas. Cada transición escribe una fila en `model_change_event` con el tipo de actor, el usuario y el `run`.

Los avisos de puerta se calculan en `DoorRules` y se unen a los del motor en `ChangeFindings`. Devuelven estado y evidencia enlazada. `ChangeEstimate` calcula, para un cambio de tipo, la diferencia entre el precio por unidad del tipo propuesto y el del tipo actual en la versión base; una propiedad con `price_key` suma un costo adicional por unidad. Cada cantidad lleva su fuente. Si falta un precio, o no está en COP por unidad, falta la diferencia. Al aprobar y al restaurar los precios se copian con su fuente, su fecha y `copiedFrom`, y la estimación aprobada queda congelada. La imagen, incluida la salida opcional de Prisma, es referencia visual.

Las rutas `/design-changes` de la propuesta de puerta son una fachada sobre los mismos casos de uso y conservan su forma. `POST /design-changes` crea el borrador, añade el cambio de tipo y lo previsualiza; si la vista previa sale bien, lo envía a aprobación. El `/apply` del motor y `BimEditPort.apply` ya no se usan y se borrarán junto con V16.

## Recorrido local

El recorrido vive detrás de `ViewerPort`. Three.js usa una cápsula con ojos a 1,65 m, gravedad y un octree para colisiones con geometrías IFC. La comparación solo abre revisiones IFC del mismo archivo, transforma la pose mediante las matrices de coordinación y exige un piso libre en el destino. El índice tiene un tope de 800 000 triángulos de colisión por versión. Cada sesión mantiene como máximo dos revisiones; salir libera la alternativa. El MVP requiere unidades SI de longitud explícitas, suelo modelado y WebGL 2.
