package com.obracota.application.designoption.usecase;

import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.common.port.Transactions;
import com.obracota.domain.assistant.port.service.ImageGenerationPort;
import com.obracota.domain.assistant.port.service.ImageGenerationPort.Image;
import java.util.UUID;

/**
 * «Panorama 360° con IA»: one 2:1 equirectangular picture of the scene chosen in Escena or in a generated option, to
 * look around in the viewer. It follows the options' budget rule: the reservation is taken under the budget lock before
 * the call and never returned; with a free image provider it is 0 and nothing is reserved. The picture is not stored:
 * the client keeps it in memory.
 */
public final class Panoramas {
    public static final int WIDTH = 2048;
    public static final int HEIGHT = 1024;
    public static final int SCENE_LIMIT = 2000;

    /** The version belongs to a project the user owns; throws otherwise. */
    @FunctionalInterface public interface Access { void check(UUID project, UUID user, UUID version); }

    /** The image provider cannot draw panoramas (only the free Cloudflare one can). */
    public static final class Unavailable extends RuntimeException {
        public Unavailable() { super("Panorama provider unavailable"); }
    }

    private final Access access;
    private final ImageGenerationPort images;
    private final AiBudget budget;
    private final Transactions tx;
    private final int reserveCents;
    private final String model;

    public Panoramas(Access access, ImageGenerationPort images, AiBudget budget, Transactions tx, int reserveCents, String model) {
        this.access = access; this.images = images; this.budget = budget; this.tx = tx; this.reserveCents = reserveCents; this.model = model;
    }

    public boolean available() { return images.panoramas(); }

    /**
     * Generates the panorama of {@code scene} (Spanish text of the scene); {@code reference} is the current view (JPEG,
     * may be null).
     *
     * @throws Unavailable when the provider cannot draw panoramas; nothing is reserved then
     * @throws AiBudget.Exhausted when the month has no room for the reservation
     */
    public Image generate(UUID project, UUID version, UUID user, String scene, byte[] reference) {
        if (scene == null || scene.isBlank() || scene.length() > SCENE_LIMIT) throw new IllegalArgumentException("Scene text required");
        if (!images.panoramas()) throw new Unavailable();
        tx.required(() -> {
            access.check(project, user, version);
            budget.lock();
            if (reserveCents > 0) budget.reserve(reserveCents);
            return null;
        });
        return images.panorama(model, reference, prompt(scene, reference != null), WIDTH, HEIGHT);
    }

    /** The provider prompt: the scene in the person's words inside fixed 360° instructions. */
    public static String prompt(String scene, boolean withReference) {
        return "Equirectangular 360 degree panorama, 2:1 aspect ratio, seamless horizon, the left and right edges join without a seam, "
            + "level horizon at mid height, eye-level viewpoint standing in front of the building, photographic and natural light. "
            + (withReference ? "The attached image is the current view of the building: keep its architecture, volumes and materials recognisable. " : "")
            + "No text, no labels, no watermark, no people unless the scene asks for them. Scene: " + scene.strip().replaceAll("\\s+", " ");
    }
}
