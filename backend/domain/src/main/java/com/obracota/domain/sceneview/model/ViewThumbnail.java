package com.obracota.domain.sceneview.model;

import java.util.Base64;

/** JPEG preview of a saved view. Only small JPEG images are accepted. */
public record ViewThumbnail(byte[] bytes, String type) {
    public static final int LIMIT=80*1024;
    public static final String JPEG="image/jpeg";
    private static final String PREFIX="data:"+JPEG+";base64,";

    public ViewThumbnail {
        if (!JPEG.equals(type) || bytes == null || bytes.length < 3 || bytes.length > LIMIT)
            throw new IllegalArgumentException("Miniatura inválida");
        // Every JPEG starts with the SOI marker followed by another marker.
        if (bytes[0] != (byte) 0xFF || bytes[1] != (byte) 0xD8 || bytes[2] != (byte) 0xFF)
            throw new IllegalArgumentException("Miniatura inválida");
        bytes=bytes.clone();
    }

    /** Reads a {@code data:image/jpeg;base64,…} URL as sent by the browser. */
    public static ViewThumbnail fromDataUrl(String value) {
        if (value == null || !value.startsWith(PREFIX)) throw new IllegalArgumentException("Miniatura inválida");
        String data=value.substring(PREFIX.length());
        // Reject oversized payloads before decoding them.
        if (data.length() > (LIMIT+2)/3*4) throw new IllegalArgumentException("Miniatura demasiado grande");
        try {
            return new ViewThumbnail(Base64.getDecoder().decode(data),JPEG);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Miniatura inválida",e);
        }
    }

    @Override public byte[] bytes() { return bytes.clone(); }
}
