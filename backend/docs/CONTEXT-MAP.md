# Mapa de contextos

**Security** es dueño de usuarios y sesiones. El filtro entrega a la infraestructura REST el UUID del usuario autenticado. Los contextos de negocio reciben ese identificador desde la frontera autenticada.

**Security → Project.** Project conserva un UserId de propietario. La migración V2 enlaza project.owner_id con security_user.id. El agregado y los casos de uso de Project desconocen JWT y JPA. ReStage sigue disponible para invitados en el catálogo de ejemplo.

**Project → ModelFile.** Cada archivo pertenece a un proyecto. Su nombre de catálogo es único dentro de esa obra.
