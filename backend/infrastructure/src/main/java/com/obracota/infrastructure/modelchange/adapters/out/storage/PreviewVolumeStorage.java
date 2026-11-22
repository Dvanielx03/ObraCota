package com.obracota.infrastructure.modelchange.adapters.out.storage;

import com.obracota.domain.modelchange.port.PreviewStorage;
import com.obracota.domain.modelversion.port.OriginalStorage;
import com.obracota.domain.project.event.ProjectDeletedEvent;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import java.util.stream.Stream;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Verified previews on the models volume, outside the project folders that {@code VolumeStorage} owns (R11):
 * {@code ${models.directory}/.previews/{project}/{change}/{previewId}.ifc}. Each preview has its own name, so two
 * previews of the same change never write the same path; a file is written as {@code .part} and moved atomically.
 */
public class PreviewVolumeStorage implements PreviewStorage {
    static final String PART = ".ifc.part";
    static final String IFC = ".ifc";

    /** One file found on the volume by {@link #files()}. */
    public record Entry(UUID project, UUID change, Path path, String name, FileTime modified) {
        /** The preview id of a finished file, or empty for a {@code .part} or a foreign name. */
        public Optional<UUID> previewId() {
            if (!name.endsWith(IFC) || name.endsWith(PART)) return Optional.empty();
            try {
                return Optional.of(UUID.fromString(name.substring(0, name.length() - IFC.length())));
            } catch (IllegalArgumentException e) {
                return Optional.empty();
            }
        }

        public boolean partial() { return name.endsWith(PART); }
    }

    private final Path root;

    public PreviewVolumeStorage(Path root) { this.root = root; }

    public Path root() { return root; }

    private Path folder(UUID project, UUID change) { return root.resolve(project.toString()).resolve(change.toString()); }

    private Path file(UUID project, UUID change, UUID preview) { return folder(project, change).resolve(preview + IFC); }

    @Override
    public Stored write(UUID project, UUID change, UUID previewId, InputStream source) throws IOException {
        var destination = file(project, change, previewId);
        var part = destination.resolveSibling(previewId + PART);
        Files.createDirectories(destination.getParent());
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        long size = 0;
        try {
            try (var output = open(part)) {
                byte[] block = new byte[65536];
                for (int n; (n = source.read(block)) != -1; ) {
                    size += n;
                    if (size > OriginalStorage.LIMIT) throw new IOException("La vista previa supera el tamaño permitido.");
                    output.write(block, 0, n);
                    digest.update(block, 0, n);
                }
            }
            Files.move(part, destination, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException | RuntimeException | Error e) {
            Files.deleteIfExists(part);
            throw e;
        }
        return new Stored(previewId, HexFormat.of().formatHex(digest.digest()), size);
    }

    @Override
    public InputStream read(UUID project, UUID change, UUID previewId) throws IOException {
        return Files.newInputStream(file(project, change, previewId));
    }

    @Override
    public boolean exists(UUID project, UUID change, UUID previewId) {
        return Files.isRegularFile(file(project, change, previewId));
    }

    /** The sweeper may remove an empty folder between {@code createDirectories} and the open: then it is created again. */
    private static java.io.OutputStream open(Path part) throws IOException {
        try {
            return Files.newOutputStream(part, StandardOpenOption.CREATE_NEW);
        } catch (NoSuchFileException gone) {
            Files.createDirectories(part.getParent());
            return Files.newOutputStream(part, StandardOpenOption.CREATE_NEW);
        }
    }

    /** Removes one preview file; its folder stays (the sweeper removes empty folders). */
    @Override
    public void delete(UUID project, UUID change, UUID previewId) {
        quietly(file(project, change, previewId));
    }

    @Override
    public void deleteAll(UUID project, UUID change) { removeTree(folder(project, change)); }

    /** Every file under {@code .previews/{project}/{change}/}, for the sweeper. Unknown names are listed too. */
    public List<Entry> files() {
        var found = new ArrayList<Entry>();
        if (!Files.isDirectory(root)) return found;
        for (var projectDir : children(root)) {
            var project = uuid(projectDir);
            if (project == null || !Files.isDirectory(projectDir)) continue;
            for (var changeDir : children(projectDir)) {
                var change = uuid(changeDir);
                if (change == null || !Files.isDirectory(changeDir)) continue;
                for (var file : children(changeDir)) {
                    if (!Files.isRegularFile(file)) continue;
                    try {
                        found.add(new Entry(project, change, file, file.getFileName().toString(), Files.getLastModifiedTime(file)));
                    } catch (IOException ignored) { }
                }
            }
        }
        return found;
    }

    /** Removes one file found by {@link #files()} and its folders when they are left empty. Best effort. */
    public void remove(Entry entry) {
        quietly(entry.path());
        quietly(entry.path().getParent());
        quietly(entry.path().getParent().getParent());
    }

    /** {@code VolumeStorage.projectRemoved} does not walk subfolders, so the previews have their own listener (R11). */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void projectRemoved(ProjectDeletedEvent event) {
        removeTree(root.resolve(event.projectId().value().toString()));
    }

    private static void removeTree(Path folder) {
        if (!Files.isDirectory(folder)) return;
        try (Stream<Path> walk = Files.walk(folder)) {
            walk.sorted(Comparator.reverseOrder()).forEach(PreviewVolumeStorage::quietly);
        } catch (IOException | UncheckedIOException ignored) { }
    }

    private static List<Path> children(Path folder) {
        try (var list = Files.list(folder)) {
            return list.toList();
        } catch (IOException | UncheckedIOException e) {
            return List.of();
        }
    }

    private static UUID uuid(Path path) {
        try {
            return UUID.fromString(path.getFileName().toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Deletes a file, or a folder only when it is empty. Never throws. */
    private static void quietly(Path path) {
        try { Files.deleteIfExists(path); } catch (IOException | RuntimeException ignored) { }
    }
}
