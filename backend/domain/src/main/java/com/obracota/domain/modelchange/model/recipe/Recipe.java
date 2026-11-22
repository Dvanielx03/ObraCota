package com.obracota.domain.modelchange.model.recipe;

import java.util.*;

/**
 * Ordered list of 0 to {@link #LIMIT} operations, format {@value #FORMAT}. Every operation carries a unique id and no
 * two operations share a target. Submitting needs at least one operation; the engine also accepts an empty recipe.
 */
public record Recipe(String format, List<Operation> operations) {
    public static final String FORMAT = "obracota.recipe/1";
    public static final int LIMIT = 20;
    private static final int MAX_ID = 999;

    public Recipe {
        if (!FORMAT.equals(format)) throw new IllegalArgumentException("El formato de la receta es " + FORMAT);
        if (operations == null || operations.stream().anyMatch(Objects::isNull)) throw new IllegalArgumentException("Operaciones inválidas");
        operations = List.copyOf(operations);
        if (operations.size() > LIMIT) throw new IllegalArgumentException("La receta admite como máximo " + LIMIT + " operaciones");
        var ids = new HashSet<String>();
        var targets = new HashSet<String>();
        for (var operation : operations) {
            if (operation.id() == null || !ids.add(operation.id())) throw new IllegalArgumentException("Cada operación necesita un id único");
            if (!targets.add(operation.target())) throw new IllegalArgumentException("Dos operaciones cambian lo mismo");
        }
    }

    public static Recipe empty() { return new Recipe(FORMAT, List.of()); }

    public boolean isEmpty() { return operations.isEmpty(); }

    public Optional<Operation> find(String id) {
        return operations.stream().filter(operation -> operation.id().equals(id)).findFirst();
    }

    /** {@code op-<max+1>}: the largest number in use plus one. */
    public String nextId() {
        int max = operations.stream().mapToInt(operation -> Integer.parseInt(operation.id().substring(3))).max().orElse(0);
        if (max >= MAX_ID) throw new IllegalArgumentException("La receta agotó sus identificadores; crea un cambio nuevo");
        return "op-" + (max + 1);
    }

    /** The operation, other than {@code except}, that already targets what {@code candidate} targets. */
    public Optional<Operation> conflict(Operation candidate, String except) {
        return operations.stream()
            .filter(operation -> !operation.id().equals(except) && operation.target().equals(candidate.target()))
            .findFirst();
    }

    /** Appends {@code operation} with the next id, whatever id it carried. */
    public Recipe append(Operation operation) {
        var next = new ArrayList<>(operations);
        next.add(operation.withId(nextId()));
        return new Recipe(format, next);
    }

    /** Puts {@code operation} in the place of {@code id}, keeping that id. */
    public Recipe replace(String id, Operation operation) {
        int index = indexOf(id);
        var next = new ArrayList<>(operations);
        next.set(index, operation.withId(id));
        return new Recipe(format, next);
    }

    public Recipe remove(String id) {
        int index = indexOf(id);
        var next = new ArrayList<>(operations);
        next.remove(index);
        return new Recipe(format, next);
    }

    private int indexOf(String id) {
        for (int index = 0; index < operations.size(); index++) if (operations.get(index).id().equals(id)) return index;
        throw new IllegalArgumentException("La operación no existe");
    }
}
