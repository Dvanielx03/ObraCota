package com.obracota.domain.modelfile.model;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public record ModelFile(UUID id, UUID projectId, String name, String format) {
    /**
     * Originals a project keeps as versions: IFC and DWG, the Revit RVT kept as is (not drawn nor edited),
     * and the FBX and OBJ meshes manufacturers publish.
     */
    public static final Set<String> FORMATS = Set.of("IFC", "DWG", "RVT", "FBX", "OBJ");
    public static String formatOf(String name) {
        if (name == null || name.isBlank() || name.length() > 255 || name.contains("/") || name.contains("\\") ||
                name.chars().anyMatch(Character::isISOControl)) throw new IllegalArgumentException("Nombre inválido");
        int dot = name.lastIndexOf('.');
        String format = dot > 0 ? name.substring(dot + 1).toUpperCase(Locale.ROOT) : "";
        if (!FORMATS.contains(format)) throw new IllegalArgumentException("Formato inválido");
        return format;
    }
    public static ModelFile register(UUID projectId, String name) {
        return new ModelFile(UUID.randomUUID(), projectId, name, formatOf(name));
    }
}
