package com.obracota.domain.modelversion.port;

import java.io.*;
import java.util.UUID;

public interface OriginalStorage {
    long LIMIT = 256L * 1024 * 1024;
    record Receipt(long size, String sha256) {}
    Receipt write(UUID project, UUID version, String format, InputStream source) throws IOException;
    InputStream read(UUID project, UUID version) throws IOException;
}
