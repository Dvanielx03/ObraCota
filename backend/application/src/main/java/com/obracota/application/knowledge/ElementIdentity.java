package com.obracota.application.knowledge;

import com.obracota.application.common.exception.InvalidRequestApplicationException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * The identity a specification is linked to. In an IFC version it is the element's GlobalId (22 characters of the IFC
 * base-64 alphabet, the first one 0–3), so a sheet cannot drift to another piece when the express ids change between
 * revisions; in a DWG plan it is the selection key the viewer reads from the drawing. Other formats have no verifiable
 * element identity and take no sheets.
 */
public final class ElementIdentity {
    private static final Pattern GLOBAL_ID = Pattern.compile("[0-3][0-9A-Za-z_$]{21}");

    private ElementIdentity() {}

    public static boolean globalId(String value) {
        return value != null && GLOBAL_ID.matcher(value).matches();
    }

    /** @throws InvalidRequestApplicationException when {@code element} is not an identity of a {@code format} version */
    public static void require(String format, String element) {
        if (element == null || element.isBlank() || element.length() > 512) throw new IllegalArgumentException();
        switch (format) {
            case "IFC" -> {
                if (!globalId(element)) throw new InvalidRequestApplicationException("ELEMENT_IDENTITY",
                    "La pieza no tiene un GlobalId IFC verificable (22 caracteres).");
            }
            case "DWG" -> { /* A selection of the drawing, keyed as the viewer reads it. */ }
            default -> throw new InvalidRequestApplicationException("ELEMENT_IDENTITY",
                "Las fichas se vinculan a piezas IFC con GlobalId o a selecciones de un plano DWG.");
        }
    }

    /** Whether the IFC (STEP text) declares the GlobalId as a string literal, read as a stream. */
    public static boolean declares(InputStream ifc, String globalId) throws IOException {
        byte[] pattern = ("'" + globalId + "'").getBytes(StandardCharsets.US_ASCII);
        int[] fallback = new int[pattern.length];
        for (int i = 1, k = 0; i < pattern.length; i++) {
            while (k > 0 && pattern[i] != pattern[k]) k = fallback[k - 1];
            if (pattern[i] == pattern[k]) k++;
            fallback[i] = k;
        }
        byte[] block = new byte[1 << 16];
        int k = 0;
        for (int n; (n = ifc.read(block)) > 0; ) {
            for (int i = 0; i < n; i++) {
                while (k > 0 && block[i] != pattern[k]) k = fallback[k - 1];
                if (block[i] == pattern[k]) k++;
                if (k == pattern.length) return true;
            }
        }
        return false;
    }
}
