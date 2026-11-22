package com.obracota.application.modelchange.rules;

import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.security.model.Actor;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What the actor who asks can do with a change now (§2.3, §4.2). Every action that is not allowed carries its reason,
 * starting with «Pendiente: », so the card can show it on the disabled control.
 */
public record ChangeActions(boolean edit, boolean preview, boolean submit, boolean apply, boolean restore, boolean discard,
                            Map<String, String> reasons) {
    /** What the use case knows about the change besides its own fields. */
    public record Facts(boolean baseLatest, int latestRevision, boolean appliedExists, boolean appliedLatest,
                        boolean reportCurrent, boolean previewAvailable) {}

    static final String STALE = "Pendiente: la base ya no es la última revisión; descarta este cambio o propón uno nuevo sobre v%d";
    static final String PUBLISH = "Pendiente: publicar y restaurar exigen la sesión de la propietaria";
    static final String NOT_OWN = "Pendiente: el agente solo trabaja sobre sus propios borradores";

    public ChangeActions { reasons = Collections.unmodifiableMap(new LinkedHashMap<>(reasons)); }

    public static ChangeActions of(Actor actor, ModelChange change, Facts facts) {
        var reasons = new LinkedHashMap<String, String>();
        var status = change.status();
        boolean touch = change.touchableBy(actor);
        String stale = STALE.formatted(facts.latestRevision());

        String edit = !touch ? NOT_OWN
            : status == ChangeStatus.READY ? "Pendiente: la receta queda fija mientras el cambio espera aprobación"
            : status != ChangeStatus.DRAFT ? closed(status)
            : !facts.baseLatest() ? stale : null;

        String preview = !touch ? NOT_OWN
            : !status.pending() ? closed(status)
            : !facts.baseLatest() ? stale : null;

        String submit = !touch ? NOT_OWN
            : status == ChangeStatus.READY ? "Pendiente: el cambio ya está listo para aprobar"
            : status != ChangeStatus.DRAFT ? closed(status)
            : !facts.baseLatest() ? stale
            : change.recipe().isEmpty() ? "Pendiente: añade al menos una operación"
            : !facts.reportCurrent() ? "Pendiente: previsualiza el cambio para enviarlo"
            : !change.report().ok() ? "Pendiente: la vista previa no superó las comprobaciones"
            : !facts.previewAvailable() ? "Pendiente: previsualízalo de nuevo para enviarlo" : null;

        String apply = !actor.person() ? PUBLISH
            : status == ChangeStatus.DRAFT ? "Pendiente: previsualiza y envía el cambio para aprobarlo"
            : status != ChangeStatus.READY ? closed(status)
            : !facts.baseLatest() ? stale
            : !facts.reportCurrent() || !change.report().ok() || !facts.previewAvailable()
                ? "Pendiente: previsualízalo de nuevo para aprobarlo" : null;

        String restore = !actor.person() ? PUBLISH
            : status == ChangeStatus.RESTORED ? "Pendiente: el cambio ya está restaurado"
            : status == ChangeStatus.DISCARDED ? "Pendiente: el cambio está descartado"
            : status != ChangeStatus.APPLIED ? "Pendiente: el cambio todavía no se aplicó"
            : !facts.appliedExists() ? "Pendiente: la versión aplicada ya no existe"
            : !facts.appliedLatest() ? "Pendiente: hay una revisión posterior (v%d); restaurar solo deshace la última"
                .formatted(facts.latestRevision()) : null;

        String discard = !touch ? NOT_OWN
            : status.published() ? "Pendiente: un cambio aplicado se revierte con una revisión de restauración"
            : status == ChangeStatus.DISCARDED ? "Pendiente: el cambio ya está descartado" : null;

        put(reasons, "edit", edit);
        put(reasons, "preview", preview);
        put(reasons, "submit", submit);
        put(reasons, "apply", apply);
        put(reasons, "restore", restore);
        put(reasons, "discard", discard);
        return new ChangeActions(edit == null, preview == null, submit == null, apply == null, restore == null, discard == null, reasons);
    }

    private static void put(Map<String, String> reasons, String action, String reason) {
        if (reason != null) reasons.put(action, reason);
    }

    private static String closed(ChangeStatus status) {
        return switch (status) {
            case APPLIED -> "Pendiente: el cambio ya está aplicado";
            case RESTORED -> "Pendiente: el cambio ya está restaurado";
            case DISCARDED -> "Pendiente: el cambio está descartado";
            default -> "Pendiente: el estado del cambio no lo permite";
        };
    }
}
