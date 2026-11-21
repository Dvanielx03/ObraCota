# Mapa de contextos

**Security** es dueño de usuarios y sesiones. El filtro entrega a la infraestructura REST el UUID del usuario autenticado. Los contextos de negocio reciben ese identificador desde la frontera autenticada.

**Security → Project.** Project conserva un UserId de propietario. La migración V2 enlaza project.owner_id con security_user.id. El agregado y los casos de uso de Project desconocen JWT y JPA. ReStage sigue disponible para invitados en el catálogo de ejemplo.

**Project → ModelFile.** Cada archivo pertenece a un proyecto. Su nombre de catálogo es único dentro de esa obra.

**ModelFile → ModelVersion.** La versión identifica una entrega concreta. Es dueña de sus metadatos y de las observaciones sobre sus elementos. La autorización procede del proyecto. El visor local y el ejemplo público siguen disponibles sin subir contenido.

**ModelVersion → DesignOption.** Una petición visual se identifica por versión y elemento. Conserva la captura, las tres alternativas y la elección explícita. La selección queda separada de la aprobación de un cambio de geometría.

**DesignOption → AiModel y AiRun.** El catálogo identifica el modelo de chat y el de imagen. El diario registra cada llamada, incluidos fallos e interrupciones con consumo desconocido. El dominio define ambos puertos del proveedor.

**ModelVersion → fichas técnicas.** Una ingeniera vincula un PDF a un elemento de una versión que le pertenece. El original, su huella y el texto por página quedan asociados a esa versión. El inspector consulta las propiedades IFC desde el visor y busca las citas del PDF en el contexto de conocimiento.

**ModelVersion → DesignChange.** Una propuesta conserva el IFC de origen, la puerta, el tipo pedido, la descripción, una imagen opcional y la revisión técnica. La decisión de la propietaria publica una revisión distinta. Restaurar copia los bytes de la base como una tercera revisión.

**DesignChange → RuleFinding y presupuesto.** RuleFinding evalúa metadatos del muro, el hueco rectangular y la regla de ancho que define la ingeniera. El presupuesto conserva cantidades y los precios ingresados con fuente y fecha. La propuesta guarda ese resultado con sus datos de origen.

**DesignChange → motor IFC.** El motor recibe la referencia de una versión, inspecciona la geometría y devuelve un IFC temporal. ModelVersion conserva la propiedad sobre originales y revisiones. El visor compara originales IFC del mismo archivo desde una pose en común.
