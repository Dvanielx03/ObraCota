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
        source.mark(HEAD);
        if (!compatible(format,source.readNBytes(HEAD))) throw new IllegalArgumentException("Cabecera incompatible");
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
    /** Bytes read to judge a header. The form reads the same window (file-header.ts, HEADER_BYTES). */
    public static final int HEAD=4096;
    private static final byte[] FBX_BINARY="Kaydara FBX Binary  \0".getBytes(StandardCharsets.US_ASCII);
    private static final java.util.regex.Pattern DXF_HEAD=java.util.regex.Pattern.compile("(?:999\\s*\\r?\\n[^\\n]*\\r?\\n\\s*)*0\\s*\\r?\\n\\s*SECTION\\b");
    /** Signature of an OLE compound file, the container Revit saves an RVT in. */
    private static final byte[] OLE={(byte)0xD0,(byte)0xCF,0x11,(byte)0xE0,(byte)0xA1,(byte)0xB1,0x1A,(byte)0xE1};
    // Statements of a Wavefront OBJ (geometry, grouping, materials and free-form curves) or a comment.
    private static final java.util.regex.Pattern OBJ_LINE=java.util.regex.Pattern.compile(
        "^(#.*|(v|vt|vn|vp|f|l|p|o|g|s|mtllib|usemtl|cstype|deg|bmat|step|curv|curv2|surf|parm|trim|hole|scrv|sp|end|con|mg|bevel|c_interp|d_interp|lod|shadow_obj|trace_obj|ctech|stech|call|csh)(\\s.*)?)$");
    // A vertex, texture coordinate, normal or face with its numbers: what makes the text an actual mesh.
    private static final java.util.regex.Pattern OBJ_GEOMETRY=java.util.regex.Pattern.compile(
        "^((v|vt|vn)\\s+[-+]?(\\d|\\.\\d).*|f\\s+-?\\d.*)$");
    /**
     * Whether the first bytes of an original match its declared format: the STEP header of an IFC, the
     * AC10xx version of a DWG, the OLE compound-file signature of a Revit RVT, the binary or ASCII
     * signature of an FBX, or, for an OBJ (plain text with no signature), text without NUL bytes whose complete lines are all OBJ statements or comments, at least
     * one of them a vertex or a face. A head shorter than {@link #HEAD} is the whole file, so its last line
     * is complete; otherwise the last line may be cut and is not judged.
     */
    public static boolean compatible(String format, byte[] head) {
        var text=new String(head,StandardCharsets.UTF_8).replace("﻿","").stripLeading();
        return switch(format) {
            case "IFC" -> text.startsWith("ISO-10303-21;");
            case "DWG" -> text.matches("(?s)^AC10[0-9]{2}.*");
            // ASCII DXF: optional 999 comments, then the first section; or the sentinel of a binary DXF.
            case "DXF" -> text.startsWith("AutoCAD Binary DXF") || DXF_HEAD.matcher(text).lookingAt();
            case "RVT" -> head.length>=OLE.length && Arrays.equals(head,0,OLE.length,OLE,0,OLE.length);
            case "FBX" -> Arrays.equals(head,0,Math.min(head.length,FBX_BINARY.length),FBX_BINARY,0,FBX_BINARY.length) || text.startsWith("; FBX");
            case "OBJ" -> {
                if(text.isBlank()) yield false;
                for(int i=0;i<head.length;i++) if(head[i]==0) yield false;
                var lines=text.split("\\r?\\n",-1);
                int complete=head.length<HEAD?lines.length:lines.length-1;
                boolean geometry=false;
                for(int i=0;i<complete;i++) {
                    var line=lines[i].strip();
                    if(line.isEmpty()) continue;
                    if(!OBJ_LINE.matcher(line).matches()) yield false;
                    geometry|=OBJ_GEOMETRY.matcher(line).matches();
                }
                yield geometry;
            }
            default -> false;
        };
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
