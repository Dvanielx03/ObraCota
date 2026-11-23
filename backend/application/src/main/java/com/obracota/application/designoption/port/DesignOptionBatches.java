package com.obracota.application.designoption.port;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Persistence of the option batches: the request, its capture, the generated options and the selection. */
public interface DesignOptionBatches {
    record NewBatch(UUID id, UUID version, UUID owner, String element, String name, String request,
                    byte[] captured, byte[] mask) {}

    record Binary(byte[] bytes, String mime) {}

    /** A batch with this id already exists for the same version, owner, element and request (an idempotent retry). */
    boolean exists(UUID id, UUID version, UUID owner, String element, String request);

    /** Stores the batch as QUEUED for the worker. */
    void queue(NewBatch batch);

    boolean belongs(UUID version, UUID id);

    /** The batches of an element, newest first, each with its drafts, options and provider runs. */
    List<Map<String, Object>> list(UUID version, String element);

    Optional<Binary> captured(UUID id);
    Optional<Binary> mask(UUID id);

    Optional<Binary> image(UUID id, int slot);

    /** Marks {@code slot} as chosen when the batch is READY and the option exists; false otherwise. */
    boolean select(UUID id, int slot);
}
