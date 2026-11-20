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
