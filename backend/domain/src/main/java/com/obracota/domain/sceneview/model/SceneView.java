package com.obracota.domain.sceneview.model;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A named camera pose saved for one version of a model, with an optional JPEG preview. */
public record SceneView(UUID id, UUID versionId, String name, List<Double> position, List<Double> target, double span, Instant createdAt,
                        boolean hasThumbnail) {
    public static final int NAME_LIMIT=60;
    public SceneView {
        name=validName(name);
        position=vector(position); target=vector(target);
        if (!Double.isFinite(span) || span <= 0) throw new IllegalArgumentException("Vista inválida");
        if (position.equals(target)) throw new IllegalArgumentException("Vista inválida");
    }
    public static String validName(String value) {
        if (value == null || value.isBlank() || value.strip().length() > NAME_LIMIT)
            throw new IllegalArgumentException("Nombre de vista inválido");
        return value.strip();
    }
    private static List<Double> vector(List<Double> value) {
        if (value == null || value.size() != 3 || value.stream().anyMatch(n -> n == null || !Double.isFinite(n)))
            throw new IllegalArgumentException("Vista inválida");
        return List.copyOf(value);
    }
    public SceneView renamed(String value) { return new SceneView(id,versionId,value,position,target,span,createdAt,hasThumbnail); }
}
