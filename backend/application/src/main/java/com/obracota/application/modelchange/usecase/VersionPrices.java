package com.obracota.application.modelchange.usecase;

import com.obracota.application.common.exception.ConflictApplicationException;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.port.PriceBook;
import com.obracota.domain.security.model.Actor;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Unit prices of a version and the project's minimum door width. Anyone who reaches the project reads them; only the
 * person sets or copies them, because their source and date are the engineer's responsibility.
 */
public final class VersionPrices {
    public static final int LIMIT = 20;

    private final ProjectVersions versions;
    private final PriceBook prices;
    private final Transactions tx;

    public VersionPrices(ProjectVersions versions, PriceBook prices, Transactions tx) {
        this.versions = versions;
        this.prices = prices;
        this.tx = tx;
    }

    /** Minimum nominal door width of the project ({@code null} until she records it) and the prices of the version. */
    public record PriceList(BigDecimal minimumWidth, List<UnitPrice> prices) {
        public PriceList { prices = List.copyOf(prices); }
    }

    public PriceList read(Actor actor, UUID project, UUID version) {
        Guards.reach(actor, project);
        versions.get(project, actor.user(), version);
        return list(project, version);
    }

    /**
     * Records up to {@value #LIMIT} prices, each replacing the one with the same key in this version, and, when given,
     * the minimum width. The prices she types are never copies.
     */
    public PriceList replace(Actor actor, UUID project, UUID version, BigDecimal minimumWidth, List<UnitPrice> input) {
        Guards.person(actor);
        if (minimumWidth != null && (minimumWidth.signum() <= 0 || minimumWidth.compareTo(BigDecimal.TEN) > 0 || minimumWidth.scale() > 6))
            throw new IllegalArgumentException("Ancho mínimo inválido");
        if (input != null && input.size() > LIMIT) throw new IllegalArgumentException("Como máximo " + LIMIT + " precios");
        return tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            versions.get(project, actor.user(), version);
            if (minimumWidth != null) prices.minimumWidth(project, minimumWidth);
            if (input != null) for (var price : input) prices.put(project, version, price.asCopyFrom(null));
            return list(project, version);
        });
    }

    /** Copies from {@code from}, an earlier revision of the same file, the keys {@code version} lacks, with source and date. */
    public PriceList copy(Actor actor, UUID project, UUID version, UUID from) {
        Guards.person(actor);
        return tx.required(() -> {
            versions.catalog().requireOwnerForUpdate(project, actor.user());
            var target = versions.get(project, actor.user(), version);
            var source = versions.get(project, actor.user(), from);
            if (!source.fileId().equals(target.fileId()))
                throw new ConflictApplicationException("Los precios solo se copian entre revisiones del mismo archivo.");
            if (source.revision() >= target.revision())
                throw new IllegalArgumentException("La versión de origen tiene que ser una revisión anterior");
            prices.copyMissing(project, source.id(), target.id());
            return list(project, version);
        });
    }

    private PriceList list(UUID project, UUID version) {
        return new PriceList(prices.minimumWidth(project).orElse(null), prices.prices(project, version));
    }
}
