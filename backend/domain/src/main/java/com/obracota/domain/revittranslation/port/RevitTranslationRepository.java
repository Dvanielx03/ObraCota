package com.obracota.domain.revittranslation.port;

import com.obracota.domain.revittranslation.model.RevitTranslation;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface RevitTranslationRepository {
    /** Inserts the translation or replaces the stored one with the same id. */
    void save(RevitTranslation translation);
    /** The most recent translation of a version. */
    Optional<RevitTranslation> latest(UUID version);
    /** Marks every unfinished translation as failed with {@code message}; returns how many. */
    int failRunning(String message, Instant now);
}
