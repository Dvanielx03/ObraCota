# Mapa de contextos

**Security** es dueño de usuarios y sesiones. El filtro entrega a la infraestructura REST el UUID del usuario autenticado. Los contextos de negocio reciben ese identificador desde la frontera autenticada.

**Security → Project.** Project conserva un UserId de propietario. La migración V2 enlaza project.owner_id con security_user.id. El agregado y los casos de uso de Project desconocen JWT y JPA. ReStage sigue disponible para invitados en el catálogo de ejemplo.

**Project → ModelFile.** Cada archivo pertenece a un proyecto. Su nombre de catálogo es único dentro de esa obra.

**ModelFile → ModelVersion.** La versión identifica una entrega concreta. Es dueña de sus metadatos y de las observaciones sobre sus elementos. La autorización procede del proyecto. El visor local y el ejemplo público siguen disponibles sin subir contenido.

**ModelVersion → DesignOption.** Una petición visual se identifica por versión y elemento. Conserva la captura, las tres alternativas y la elección explícita. La selección queda separada de la aprobación de un cambio de geometría.

**DesignOption → AiModel y AiRun.** El catálogo identifica el modelo de chat y el de imagen. El diario registra cada llamada, incluidos fallos e interrupciones con consumo desconocido. El dominio define ambos puertos del proveedor.

**ModelVersion → fichas técnicas.** Una ingeniera vincula un PDF a un elemento de una versión que le pertenece. El original, su huella y el texto por página quedan asociados a esa versión. El inspector consulta las propiedades IFC desde el visor y busca las citas del PDF en el contexto de conocimiento.

**ModelVersion → ModelChange.** Un cambio de modelo parte de una versión base, que debe ser la última de su archivo. Conserva una receta de operaciones tipadas (`ifc.change_type` e `ifc.set_property` en H1), su origen (persona o agente), el informe de la vista previa y el registro de quién envió, aprobó, restauró o descartó. Su ciclo es `DRAFT → READY → APPLIED → RESTORED`, más `DISCARDED`. Aprobar publica como revisión nueva los bytes exactos de la vista previa verificada. Restaurar copia los bytes de la base como otra revisión. Publicar una revisión deja vencidos los demás borradores sobre la base anterior: solo se pueden descartar.

**Security → ModelChange.** El filtro JWT distingue la sesión de la persona de la credencial de agente, ligada a un proyecto y a un `run`. Cada caso de uso recibe un `Actor`. El agente crea, edita, previsualiza, envía y descarta sus propios borradores. Publicar, restaurar y fijar o copiar precios exigen la sesión de la persona en la URL y en `PublishModelChange` y `VersionPrices`.

**ModelChange → RuleFinding y presupuesto.** `ChangeFindings` une los avisos del motor con `DoorRules`, que evalúa metadatos del muro, el hueco rectangular y la regla de ancho que define la ingeniera. Cada cantidad indica si sale de `Qto_*`, de la geometría o de la unidad. Los precios son por versión y por clave, con unidad, fuente y fecha. Al aprobar y al restaurar se copian a la revisión nueva con su origen, y la estimación aprobada queda congelada en el cambio.

**ModelChange → motor IFC.** El motor lee la versión base del volumen de originales en modo de solo lectura. Resume y lista elementos, valida y construye la receta, compara con IfcDiff y devuelve un IFC verificado. El backend guarda ese IFC como vista previa del cambio. Aprobar no vuelve a llamar al motor. ModelVersion conserva la propiedad sobre originales y revisiones. El visor compara originales IFC del mismo archivo desde una pose en común, y también la base con la vista previa sin publicar.

**DesignChange (fachada) → ModelChange.** Las rutas `/design-changes` de la propuesta de puerta siguen vivas sobre `ModelChanges`, `PublishModelChange` y `VersionPrices`. Conservan su forma de respuesta. Las tablas `door_change` y `door_unit_price` quedan como respaldo de solo lectura de V15 hasta que V16 las borre.
