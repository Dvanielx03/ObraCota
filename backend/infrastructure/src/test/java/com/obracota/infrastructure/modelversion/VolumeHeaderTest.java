package com.obracota.infrastructure.modelversion;

import com.obracota.infrastructure.modelversion.adapters.out.storage.VolumeStorage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Arrays;
import java.util.UUID;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static org.junit.jupiter.api.Assertions.*;

class VolumeHeaderTest {
    @TempDir Path root;

    static byte[] ascii(String text) { return text.getBytes(StandardCharsets.UTF_8); }
    static byte[] binaryFbx() {
        byte[] bytes=new byte[600];
        byte[] magic=ascii("Kaydara FBX Binary  \0");
        System.arraycopy(magic,0,bytes,0,magic.length);
        bytes[21]=0x1A;bytes[23]=(byte)0xE8;bytes[24]=0x1C;
        for(int i=27;i<bytes.length;i++) bytes[i]=(byte)(i*31);
        return bytes;
    }
    static byte[] head(byte[] bytes) { return Arrays.copyOf(bytes,Math.min(bytes.length,VolumeStorage.HEAD)); }

    @Test void recognisesBinaryAndAsciiFbx() {
        assertTrue(VolumeStorage.compatible("FBX",head(binaryFbx())));
        assertTrue(VolumeStorage.compatible("FBX",ascii("; FBX 7.4.0 project file\n; ----\nFBXHeaderExtension:  {\n")));
        assertTrue(VolumeStorage.compatible("FBX",ascii("﻿; FBX 6.1.0 project file\n")));
        assertFalse(VolumeStorage.compatible("FBX",ascii("Kaydara FBX")));
        assertFalse(VolumeStorage.compatible("FBX",ascii("PK\u0003\u0004 zip")));
        assertFalse(VolumeStorage.compatible("FBX",ascii("AC1027")));
    }

    @Test void recognisesObjTextFromThreeExporters() {
        // 3ds Max (guruware), pCon.planner and a minimal hand-written mesh.
        assertTrue(VolumeStorage.compatible("OBJ",ascii("# 3ds Max Wavefront OBJ Exporter v0.97b - (c)2007 guruware\n# File Created: 20.01.2022\n\nmtllib CM21 - Essay Table.mtl\n\n#\n# object Solid2\n#\n\nv  -1089.0000 694.3162 -474.2325\n")));
        assertTrue(VolumeStorage.compatible("OBJ",ascii("# created with pCon.planner\n\nmtllib 1067 Hven Bar Stool Low.mtl\n\ng mesh_0\nv -0.00273683 0.001 0.0053829899\n")));
        assertTrue(VolumeStorage.compatible("OBJ",ascii("o Cube\r\nv 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nvn 0 0 1\r\nusemtl wood\r\ns off\r\nf 1//1 2//1 3//1\r\n")));
        // A window cut in the middle of a line still counts the complete lines before it.
        var long_=new StringBuilder("# long\n");
        while(long_.length()<VolumeStorage.HEAD+100) long_.append("v 0.123456 0.654321 0.987654\n");
        assertTrue(VolumeStorage.compatible("OBJ",head(ascii(long_.toString()))));
    }

    @Test void rejectsFilesThatOnlyLookLikeText() {
        assertFalse(VolumeStorage.compatible("OBJ",ascii("# Notas de obra\n\nRevisar la puerta P-03.\n")));
        assertFalse(VolumeStorage.compatible("OBJ",ascii("ISO-10303-21;\nHEADER;\n")));
        assertFalse(VolumeStorage.compatible("OBJ",ascii("%PDF-1.7\n")));
        assertFalse(VolumeStorage.compatible("OBJ",ascii("   \n\n")));
        assertFalse(VolumeStorage.compatible("OBJ",head(binaryFbx())));
        byte[] nul=ascii("v 0 0 0\nv 1 0 0\n");nul[3]=0;
        assertFalse(VolumeStorage.compatible("OBJ",nul));
        assertFalse(VolumeStorage.compatible("RVT",ascii("v 0 0 0\n")));
    }

    @Test void requiresAVertexOrFaceAmongTheCompleteLines() {
        // A long comment with no line break: nothing complete to judge, so it is not a mesh.
        assertFalse(VolumeStorage.compatible("OBJ",head(ascii("# "+"x".repeat(VolumeStorage.HEAD+50)))));
        // One-letter statements followed by prose, or grouping only, are not geometry.
        assertFalse(VolumeStorage.compatible("OBJ",ascii("# Lista\ns de la obra\np resto de cosas\nl ver plano\n")));
        assertFalse(VolumeStorage.compatible("OBJ",ascii("o Mesa\ng patas\nmtllib mesa.mtl\n")));
        assertFalse(VolumeStorage.compatible("OBJ",ascii("v de vigas\nf de fachada\n")));
        assertTrue(VolumeStorage.compatible("OBJ",ascii("g patas\nf 1 2 3\n")));
    }

    @Test void judgesAFileOfExactlyTheWindowAsCutLikeTheForm() {
        // HEAD bytes exactly: the last line may continue past the window, so it is not judged (the form
        // uses the same rule: complete only when the file is shorter than the window).
        var text=new StringBuilder();
        while(text.length()<VolumeStorage.HEAD-12) text.append("v 0 0 0\n");
        text.append("x".repeat(VolumeStorage.HEAD-text.length()));
        byte[] exact=ascii(text.toString());
        assertEquals(VolumeStorage.HEAD,exact.length);
        assertTrue(VolumeStorage.compatible("OBJ",exact));
        assertFalse(VolumeStorage.compatible("OBJ",Arrays.copyOf(exact,exact.length-1)));
    }

    @Test void keepsTheExistingIfcAndDwgChecks() {
        assertTrue(VolumeStorage.compatible("IFC",ascii("﻿  ISO-10303-21;\nHEADER;")));
        assertTrue(VolumeStorage.compatible("DWG",ascii("AC1032\0\0\0")));
        assertFalse(VolumeStorage.compatible("DWG",ascii("; FBX 7.4.0")));
        assertFalse(VolumeStorage.compatible("IFC",ascii("v 0 0 0\n")));
    }

    @Test void recognisesARevitOleContainerOnly() {
        byte[] rvt=new byte[600];
        byte[] ole={(byte)0xD0,(byte)0xCF,0x11,(byte)0xE0,(byte)0xA1,(byte)0xB1,0x1A,(byte)0xE1};
        System.arraycopy(ole,0,rvt,0,ole.length);
        assertTrue(VolumeStorage.compatible("RVT",rvt));
        assertFalse(VolumeStorage.compatible("RVT",Arrays.copyOf(ole,7)));
        assertFalse(VolumeStorage.compatible("RVT",ascii("PK\u0003\u0004 zip")));
        assertFalse(VolumeStorage.compatible("RVT",ascii("Format: 2025\nBuild: 20240715")));
        assertFalse(VolumeStorage.compatible("RVT",ascii("AC1032\0\0\0")));
        assertFalse(VolumeStorage.compatible("DWG",rvt));
        assertFalse(VolumeStorage.compatible("IFC",rvt));
    }

    @Test void storesAnFbxByteForByteAndRefusesAMismatchedOne() throws Exception {
        var storage=new VolumeStorage(root);
        UUID project=UUID.randomUUID(),fbx=UUID.randomUUID(),obj=UUID.randomUUID(),wrong=UUID.randomUUID();
        byte[] original=binaryFbx();
        TransactionSynchronizationManager.initSynchronization();
        try {
            assertEquals(original.length,storage.write(project,fbx,"FBX",new ByteArrayInputStream(original)).size());
            assertArrayEquals(original,Files.readAllBytes(root.resolve(project.toString()).resolve(fbx.toString())));
            byte[] text=ascii("o Tabla\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
            storage.write(project,obj,"OBJ",new ByteArrayInputStream(text));
            assertArrayEquals(text,Files.readAllBytes(root.resolve(project.toString()).resolve(obj.toString())));
            assertThrows(IllegalArgumentException.class,()->storage.write(project,wrong,"OBJ",new ByteArrayInputStream(original)));
            assertFalse(Files.exists(root.resolve(project.toString()).resolve(wrong.toString())));
        } finally { TransactionSynchronizationManager.clearSynchronization(); }
    }
}
