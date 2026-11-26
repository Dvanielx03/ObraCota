package com.obracota.application.modelchange.usecase;

import com.obracota.application.modelchange.rules.ChangeActions;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelversion.model.ModelVersion;
import java.util.Map;
import java.util.UUID;

/**
 * A change as the actor who asks sees it (§4.2): the change, its base, the latest revision of its file, whether the
 * report is current and the preview available, the allowed actions with their reasons, and the e-mail of the people
 * it mentions.
 */
public record ChangeView(ModelChange change, ModelVersion base, ModelVersion latest, boolean reportCurrent, boolean previewAvailable,
                         ChangeActions actions, Map<UUID, String> people) {
    public ChangeView { people = Map.copyOf(people); }

    public boolean baseLatest() { return latest.id().equals(base.id()); }

    /** E-mail of {@code user}, or {@code null}. */
    public String email(UUID user) { return user == null ? null : people.get(user); }
}
