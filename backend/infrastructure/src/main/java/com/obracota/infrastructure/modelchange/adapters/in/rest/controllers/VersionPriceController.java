package com.obracota.infrastructure.modelchange.adapters.in.rest.controllers;

import com.obracota.application.modelchange.usecase.VersionPrices;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.security.model.Actor;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import org.springframework.web.bind.annotation.*;

/**
 * Unit prices of a version (§4.4, §6.2). Anyone who reaches the project reads them; only the person's session records
 * or copies them, with their source and date ({@link VersionPrices} refuses any other actor). Prices are in COP.
 */
@RestController
@RequestMapping("/api/projects/{project}/versions/{version}/prices")
public class VersionPriceController {
    private final VersionPrices prices;

    public VersionPriceController(VersionPrices prices) { this.prices = prices; }

    public record Price(String key, String unit, String currency, BigDecimal amount, String source, LocalDate date, UUID copiedFrom) {}
    public record PriceList(BigDecimal minimumWidthM, List<Price> prices) {}
    public record PriceInput(String key, String unit, BigDecimal amount, String source, LocalDate date) {}
    public record Replace(BigDecimal minimumWidthM, List<PriceInput> prices) {}

    @GetMapping
    public PriceList read(@PathVariable UUID project, @PathVariable UUID version, Actor actor) {
        return list(prices.read(actor, project, version));
    }

    @PutMapping
    public PriceList replace(@PathVariable UUID project, @PathVariable UUID version, Actor actor, @RequestBody Replace body) {
        if (body == null) throw new IllegalArgumentException("Faltan los precios");
        List<UnitPrice> typed = null;
        if (body.prices() != null) {
            if (body.prices().size() > VersionPrices.LIMIT) throw new IllegalArgumentException("Como máximo " + VersionPrices.LIMIT + " precios");
            typed = new ArrayList<>();
            for (var price : body.prices()) {
                if (price == null || price.unit() == null || price.date() == null) throw new IllegalArgumentException("Precio inválido");
                if (price.source() != null && price.source().length() > UnitPrice.SOURCE_LIMIT) throw new IllegalArgumentException("Fuente inválida");
                typed.add(new UnitPrice(new PriceKey(price.key()), UnitPrice.Unit.valueOf(price.unit()), UnitPrice.COP, price.amount(),
                    price.source(), price.date(), null));
            }
        }
        return list(prices.replace(actor, project, version, body.minimumWidthM(), typed));
    }

    /** Copies from {@code from}, an earlier revision of the same file, the keys this version lacks. */
    @PostMapping("/copy")
    public PriceList copy(@PathVariable UUID project, @PathVariable UUID version, Actor actor, @RequestParam UUID from) {
        return list(prices.copy(actor, project, version, from));
    }

    private static PriceList list(VersionPrices.PriceList list) {
        return new PriceList(list.minimumWidth(), list.prices().stream().map(price -> new Price(price.key().value(), price.unit().name(),
            price.currency(), price.amount(), price.source(), price.date(), price.copiedFrom())).toList());
    }
}
