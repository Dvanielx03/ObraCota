package com.obracota.application.modelversion.usecase;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.domain.modelversion.model.*;
import com.obracota.domain.modelversion.port.*;
import com.obracota.domain.security.port.repository.SecurityRepository;
import java.io.*;
import java.time.Instant;
import java.util.*;

public record ProjectVersions(ProjectFileCatalog catalog, VersionRepository versions, OriginalStorage storage, SecurityRepository users) {
    public ModelVersion upload(UUID project, UUID user, UUID fileId, String name, long length, InputStream contents) throws IOException {
        catalog.requireOwner(project,user);
        if (length > OriginalStorage.LIMIT) throw new FileTooLargeException();
        String format=ModelFile.formatOf(name);
        UUID id=UUID.randomUUID();
        var file=catalog.resolveUpload(project,user,fileId,name);
        var receipt=storage.write(project,id,format,contents);
        var uploader=users.byId(user).orElseThrow(NotFoundApplicationException::new);
        var version=new ModelVersion(id,file.id(),versions.nextRevision(file.id()),name,format,receipt.size(),
            receipt.sha256(),Instant.now(),user,uploader.email());
        versions.insert(version);
        return version;
    }
    public ModelVersion get(UUID project, UUID user, UUID id) {
        catalog.requireOwner(project,user);
        return versions.find(project,id).orElseThrow(NotFoundApplicationException::new);
    }
    public List<ModelVersion> list(UUID project, UUID user, UUID file) {
        catalog.requireOwner(project,user);
        catalog.files().find(project,file).orElseThrow(NotFoundApplicationException::new);
        return versions.history(file);
    }
    public Map<String,String> notes(UUID project, UUID user, UUID version) {
        get(project,user,version);
        return versions.notes(version);
    }
    public void note(UUID project, UUID user, UUID version,String key,String text,boolean onlyIfAbsent) {
        get(project,user,version);
        if(key==null || key.isBlank() || key.length()>512 || text==null || text.length()>4000)
            throw new IllegalArgumentException("Observación inválida");
        versions.writeNote(version,key,text.strip(),onlyIfAbsent);
    }
}
