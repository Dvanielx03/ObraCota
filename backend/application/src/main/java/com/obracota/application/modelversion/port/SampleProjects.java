package com.obracota.application.modelversion.port;

import com.obracota.application.modelversion.usecase.SampleScopes.SampleModel;
import java.util.Optional;
import java.util.UUID;

/** The hidden project that holds a public sample for one person (see {@code V19__Sample_project.sql}). */
public interface SampleProjects {
    record Scope(UUID project, UUID version) {}

    /** Another request created the same person's sample project first. */
    final class Taken extends RuntimeException {
        public Taken(Throwable cause) { super("Sample project already exists", cause); }
    }

    Optional<Scope> find(UUID owner, String sample);

    /**
     * Creates the project, its file and version 1 of the sample. The original is not copied: the sample is a public
     * asset of the web app, and the version only anchors what the server keeps for it (options, budget).
     *
     * @throws Taken when the person's sample project already exists (a concurrent request)
     */
    Scope create(UUID owner, SampleModel sample);
}
