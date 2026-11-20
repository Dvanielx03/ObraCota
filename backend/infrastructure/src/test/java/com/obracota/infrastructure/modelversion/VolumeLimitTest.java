package com.obracota.infrastructure.modelversion;

import com.obracota.domain.modelversion.model.FileTooLargeException;
import com.obracota.domain.modelversion.port.OriginalStorage;
import com.obracota.infrastructure.modelversion.adapters.out.storage.VolumeStorage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Arrays;
import java.util.UUID;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static org.junit.jupiter.api.Assertions.*;

class VolumeLimitTest {
    @TempDir Path root;

    // Supply the boundary size as a stream without allocating a full-size fixture.
    private InputStream dwg(long length) {
        byte[] header="AC1032".getBytes(StandardCharsets.US_ASCII);
        return new SequenceInputStream(new ByteArrayInputStream(header),new InputStream() {
            long remaining=length-header.length;
            public int read() { if(remaining==0) return -1; remaining--; return 0; }
            public int read(byte[] buffer,int offset,int size) {
                if(remaining==0) return -1;
                int count=(int)Math.min(size,remaining);
                Arrays.fill(buffer,offset,offset+count,(byte)0);
                remaining-=count;
                return count;
            }
        });
    }
    @Test void acceptsTheExactLimitAndRemovesAPartialOversizedUpload() throws Exception {
        var storage=new VolumeStorage(root);
        UUID project=UUID.randomUUID(),first=UUID.randomUUID(),tooBig=UUID.randomUUID();
        TransactionSynchronizationManager.initSynchronization();
        try {
            assertEquals(OriginalStorage.LIMIT,storage.write(project,first,"DWG",dwg(OriginalStorage.LIMIT)).size());
            assertThrows(FileTooLargeException.class,()->storage.write(project,tooBig,"DWG",dwg(OriginalStorage.LIMIT+1)));
            assertFalse(Files.exists(root.resolve(project.toString()).resolve(tooBig.toString())));
        } finally { TransactionSynchronizationManager.clearSynchronization(); }
    }
}
