package com.obracota.infrastructure.modelversion.adapters.out.storage;

import com.obracota.domain.modelversion.model.FileTooLargeException;
import com.obracota.domain.modelversion.port.OriginalStorage;
import com.obracota.domain.project.event.ProjectDeletedEvent;
import org.springframework.transaction.support.*;
import org.springframework.transaction.event.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.io.*;
import java.util.*;
import java.security.*;

public class VolumeStorage implements OriginalStorage {
    private final Path root;
    public VolumeStorage(Path root) { this.root=root; }
    private Path path(UUID project, UUID version) { return root.resolve(project.toString()).resolve(version.toString()); }
    public InputStream read(UUID project, UUID version) throws IOException { return Files.newInputStream(path(project,version)); }
    public Receipt write(UUID project, UUID version, String format, InputStream input) throws IOException {
        var source=new BufferedInputStream(input);
        source.mark(512);
        var header=new String(source.readNBytes(512),StandardCharsets.UTF_8).replace("\uFEFF","").stripLeading();
        if (!(format.equals("IFC") ? header.startsWith("ISO-10303-21;") : header.matches("(?s)^AC10[0-9]{2}.*")))
            throw new IllegalArgumentException("Cabecera incompatible");
        source.reset();
        var destination=path(project,version);
        Files.createDirectories(destination.getParent());
        MessageDigest digest;
        try { digest=MessageDigest.getInstance("SHA-256"); } catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        long size=0;
        var output=Files.newOutputStream(destination,StandardOpenOption.CREATE_NEW);
        try (output) {
            byte[] block=new byte[65536];
            for(int n;(n=source.read(block))!=-1;) {
                size+=n;
                if(size>LIMIT) throw new FileTooLargeException();
                output.write(block,0,n);
                digest.update(block,0,n);
            }
        } catch(IOException | RuntimeException e) {
            Files.deleteIfExists(destination);
            throw e;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) {
                if(status==STATUS_ROLLED_BACK) remove(destination);
            }
        });
        return new Receipt(size,HexFormat.of().formatHex(digest.digest()));
    }
    private void remove(Path file) {
        try { Files.deleteIfExists(file); } catch(IOException e) { throw new UncheckedIOException(e); }
    }
    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    public void projectRemoved(ProjectDeletedEvent event) throws IOException {
        Path dir=root.resolve(event.projectId().value().toString());
        if (!Files.isDirectory(dir)) return;
        try(var originals=Files.list(dir)) { originals.forEach(this::remove); }
        Files.deleteIfExists(dir);
    }
}
