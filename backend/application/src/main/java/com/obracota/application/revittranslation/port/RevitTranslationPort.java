package com.obracota.application.revittranslation.port;

import com.obracota.domain.revittranslation.model.RevitTranslation.Status;
import java.io.IOException;
import java.nio.file.Path;

/** A service that turns a Revit RVT into IFC (Autodesk Platform Services Model Derivative). */
public interface RevitTranslationPort {
    /** False when the service is not configured (no credentials): nothing is sent anywhere. */
    boolean available();

    /** Stage changes the service reports while it works, with a short Spanish text for the person. */
    @FunctionalInterface
    interface Progress {
        void report(Status status, String message);
    }

    /** A conversion that cannot finish; the message is Spanish, safe to show and holds no credential. */
    class Failure extends RuntimeException {
        public Failure(String message) { super(message); }
    }

    /**
     * Sends the RVT at {@code rvt} under the name {@code objectKey} (ending in {@code .rvt}), waits for the IFC
     * and writes it to {@code ifc}.
     */
    void translate(String objectKey, Path rvt, Path ifc, Progress progress) throws IOException, InterruptedException;
}
