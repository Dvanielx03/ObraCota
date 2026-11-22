package com.obracota.domain.modelchange.model.price;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Price that the engineer recorded for one version, always with its source and its date. {@code copiedFrom} is the
 * version it was copied from when a revision was published or restored, or {@code null} when she typed it.
 * The validations are the ones the door pricing route applies today.
 */
public record UnitPrice(PriceKey key, Unit unit, String currency, BigDecimal amount, String source, LocalDate date, UUID copiedFrom) {
    public enum Unit { UNIT, M, M2, M3 }

    public static final String COP = "COP";
    public static final int SOURCE_LIMIT = 300;
    private static final Pattern CURRENCY = Pattern.compile("[A-Z]{3}");

    public UnitPrice {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(unit, "unit");
        if (currency == null || !CURRENCY.matcher(currency).matches()) throw new IllegalArgumentException("Moneda inválida");
        if (amount == null || amount.signum() < 0 || amount.scale() > 2 || amount.precision() > 16)
            throw new IllegalArgumentException("Importe inválido");
        if (source == null || source.isBlank() || source.strip().length() > SOURCE_LIMIT)
            throw new IllegalArgumentException("Fuente inválida");
        source = source.strip();
        Objects.requireNonNull(date, "date");
    }

    /** The same price, recorded as a copy taken from {@code version}. */
    public UnitPrice asCopyFrom(UUID version) { return new UnitPrice(key, unit, currency, amount, source, date, version); }
}
