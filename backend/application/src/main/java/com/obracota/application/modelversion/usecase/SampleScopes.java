package com.obracota.application.modelversion.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelversion.port.SampleProjects;
import com.obracota.application.modelversion.port.SampleProjects.Scope;
import com.obracota.domain.security.port.repository.SecurityRepository;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Scope of a public sample for the signed-in person: the project and version that the server tools needing one
 * (Renderizar, Panorama 360) work on while the sample viewer shows the public file. Created on first use, one per
 * person and sample, the same one afterwards; only its owner reaches it, as with any other project.
 */
public final class SampleScopes {
    /** A sample the web app publishes: what its hidden version records about the file. */
    public record SampleModel(String key, String projectName, String fileName, String format, long byteSize, String sha256) {}

    /** {@code app/public/models/restage.glb}: GLB converted from the ReStage IFC, in metres. */
    public static final SampleModel RESTAGE = new SampleModel("restage", "ReStage (muestra)", "restage.glb", "GLB", 1_989_624,
        "ec2d1b701918867def679bf80be07ae2d0c807691687a236d3b3ccaf38e3320b");
    private static final Map<String, SampleModel> SAMPLES = Map.of(RESTAGE.key(), RESTAGE);

    private final SampleProjects projects;
    private final SecurityRepository users;
    private final Transactions tx;

    public SampleScopes(SampleProjects projects, SecurityRepository users, Transactions tx) {
        this.projects = projects; this.users = users; this.tx = tx;
    }

    public static Optional<SampleModel> sample(String key) { return Optional.ofNullable(key == null ? null : SAMPLES.get(key)); }

    /** The person's scope for {@code key}, created the first time. An unknown sample is not found. */
    public Scope ensure(UUID user, String key) {
        var sample = sample(key).orElseThrow(NotFoundApplicationException::new);
        try {
            return tx.required(() -> projects.find(user, sample.key()).orElseGet(() -> {
                users.byId(user).orElseThrow(NotFoundApplicationException::new);
                return projects.create(user, sample);
            }));
        } catch (SampleProjects.Taken raced) {
            // Two first requests at once (two tabs): the other one created it, and its scope is this person's scope.
            return tx.required(() -> projects.find(user, sample.key()).orElseThrow(NotFoundApplicationException::new));
        }
    }
}
