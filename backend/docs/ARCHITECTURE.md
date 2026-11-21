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

## Cambio de puerta y recorrido local

El backend valida la pertenencia de la versión antes de acceder a `BimEditPort`. Su adaptador llama al motor IfcOpenShell por la red privada de Compose. El motor lee el volumen de originales en modo de solo lectura. La operación cambia el tipo, exporta un temporal y lo reabre para verificar representación, medidas, colocación y relación con el hueco y el anfitrión. El backend serializa la publicación con las cargas del mismo proyecto y conserva el historial de SHA-256. Restaurar crea una revisión con el SHA-256 de la base.

Los tres avisos se calculan en `DoorRules`. Devuelven estado y evidencia enlazada. El costo es la diferencia entre dos precios por unidad ingresados por la ingeniera con fuente y fecha. Si falta un precio, falta el total estimado. Para aplicar se comprueba la representación y la compatibilidad geométrica con el hueco. La imagen, incluida la salida opcional de Prisma, es referencia visual.

El recorrido vive detrás de `ViewerPort`. Three.js usa una cápsula con ojos a 1,65 m, gravedad y un octree para colisiones con geometrías IFC. La comparación solo abre revisiones IFC del mismo archivo, transforma la pose mediante las matrices de coordinación y exige un piso libre en el destino. El índice tiene un tope de 800 000 triángulos de colisión por versión. Cada sesión mantiene como máximo dos revisiones; salir libera la alternativa. El MVP requiere unidades SI de longitud explícitas, suelo modelado y WebGL 2.
