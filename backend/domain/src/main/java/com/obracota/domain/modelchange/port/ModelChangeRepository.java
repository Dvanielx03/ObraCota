package com.obracota.domain.modelchange.port;

import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.modelchange.model.ModelChange;
import com.obracota.domain.modelchange.model.ModelChangeEvent;
import java.util.*;

/** Persistence of {@code model_change} and of its audit trail {@code model_change_event}. */
public interface ModelChangeRepository {
    Optional<ModelChange> find(UUID project, UUID id);

    /**
     * Inside a transaction: takes the lock of the project row, the same one every use case that writes a change takes
     * first ({@code requireOwnerForUpdate}), and then reads the change. For writers without an owner, like the sweeper.
     */
    Optional<ModelChange> findLockingProject(UUID project, UUID id);

    /**
     * Changes of a project, most recent first ({@code created_at desc}), at most {@code limit}.
     * An empty {@code statuses} means every status; a {@code null} {@code file} means every file.
     */
    List<ModelChange> list(UUID project, Set<ChangeStatus> statuses, UUID file, int limit);

    /** {@code DRAFT} and {@code READY} changes of one file, whatever their base. */
    List<ModelChange> pending(UUID project, UUID file);

    /** {@code DRAFT} and {@code READY} changes, of any project, that still reference a preview file (for the sweeper). */
    List<ModelChange> holdingPreviews();

    /** Stores a new change and, when present, its visual reference (PNG bytes). */
    void insert(ModelChange change, byte[] picture);

    /** Stores every field of an existing change except its picture. */
    void update(ModelChange change);

    void record(ModelChangeEvent event);

    /** Audit trail of one change, oldest first. */
    List<ModelChangeEvent> events(UUID change);

    Optional<byte[]> picture(UUID project, UUID id);

    /** E-mail of each user that exists among {@code users}. */
    Map<UUID, String> emails(Collection<UUID> users);
}
