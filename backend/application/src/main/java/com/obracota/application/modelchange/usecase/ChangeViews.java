package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.modelchange.rules.ChangeActions;
import com.obracota.application.modelchange.rules.ChangeEstimate;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.port.ModelChangeRepository;
import com.obracota.domain.modelchange.port.PreviewStorage;
import com.obracota.domain.modelchange.port.PriceBook;
import com.obracota.domain.modelchange.port.RecipeCodec;
import com.obracota.domain.modelversion.model.ModelVersion;
import com.obracota.domain.security.model.Actor;
import java.util.*;

/** Builds {@link ChangeView}s, reading each file history and each base's prices once per call. */
final class ChangeViews {
    private final ProjectVersions versions;
    private final ModelChangeRepository changes;
    private final PriceBook prices;
    private final PreviewStorage previews;
    private final RecipeCodec codec;

    ChangeViews(ProjectVersions versions, ModelChangeRepository changes, PriceBook prices, PreviewStorage previews, RecipeCodec codec) {
        this.versions = versions;
        this.changes = changes;
        this.prices = prices;
        this.previews = previews;
        this.codec = codec;
    }

    /** Backend hash of a recipe: SHA-256 of its canonical JSON. */
    String hash(Recipe recipe) { return Guards.sha256(codec.canonical(recipe)); }

    ChangeView one(Actor actor, ModelChange change) { return many(actor, List.of(change)).getFirst(); }

    List<ChangeView> many(Actor actor, List<ModelChange> list) {
        var histories = new HashMap<UUID, List<ModelVersion>>();
        var books = new HashMap<UUID, List<UnitPrice>>();
        var users = new HashSet<UUID>();
        for (var change : list) {
            users.add(change.author());
            if (change.applied() != null && change.applied().by() != null) users.add(change.applied().by());
            if (change.restored() != null && change.restored().by() != null) users.add(change.restored().by());
            if (change.discarded() != null && change.discarded().by() != null) users.add(change.discarded().by());
        }
        Map<UUID, String> people = users.isEmpty() ? Map.of() : changes.emails(users);
        var views = new ArrayList<ChangeView>(list.size());
        for (var change : list) {
            var history = histories.computeIfAbsent(change.file(), file -> versions.list(change.project(), actor.user(), file));
            var base = history.stream().filter(version -> version.id().equals(change.baseVersion())).findFirst()
                .orElseThrow(NotFoundApplicationException::new);
            var latest = history.getFirst();
            var appliedId = change.applied() == null ? null : change.applied().version();
            boolean appliedExists = appliedId != null && history.stream().anyMatch(version -> version.id().equals(appliedId));
            boolean current = change.reportCurrent(hash(change.recipe()));
            boolean available = change.preview() != null && previews.exists(change.project(), change.id(), change.preview().id());
            var estimate = change.status().published() ? change.approvedEstimate()
                : ChangeEstimate.of(change.recipe(), change.report(),
                    books.computeIfAbsent(change.baseVersion(), version -> prices.prices(change.project(), version)));
            var facts = new ChangeActions.Facts(latest.id().equals(base.id()), latest.revision(), appliedExists,
                appliedExists && latest.id().equals(appliedId), current, available);
            views.add(new ChangeView(change, base, latest, current, available, estimate, ChangeActions.of(actor, change, facts), people));
        }
        return views;
    }
}
