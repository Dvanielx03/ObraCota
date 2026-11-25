package com.obracota.infrastructure.knowledge;

import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.knowledge.ElementIdentity;
import com.obracota.application.knowledge.SpecificationSearch;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelversion.model.ModelVersion;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.io.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

@RestController @RequestMapping("/api/projects/{project}/versions/{version}/specifications")
public class SpecificationController {
    private final ProjectVersions versions;
    private final JdbcTemplate db;
    private final PdfIndexWorker indexer;
    private static final int LIMIT=4*1024*1024;
    public SpecificationController(ProjectVersions versions,JdbcTemplate db,PdfIndexWorker indexer){this.versions=versions;this.db=db;this.indexer=indexer;}
    public record Document(UUID id,String filename,String status,String error,boolean originalAvailable){}
    private static Document document(java.sql.ResultSet row,int ignored) throws java.sql.SQLException {
        return new Document(row.getObject(1, UUID.class), row.getString(2), row.getString(3), row.getString(4), row.getBoolean(5));
    }
    public record Evidence(List<Document> documents,List<SpecificationSearch.Citation> citations){}
    /** The version must be the user's and {@code element} an identity of its format (see {@link ElementIdentity}). */
    private ModelVersion check(UUID project,UUID version,UUID user,String element){
        var found=versions.get(project,user,version);
        ElementIdentity.require(found.format(),element);
        return found;
    }
    @PostMapping(consumes="application/pdf") @Transactional
    public Document attach(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,
        @RequestParam String element,@RequestParam String name,HttpServletRequest request) throws IOException,NoSuchAlgorithmException {
        // Read at most one byte past the limit before any rejection. Rejecting the header alone can reset the proxied
        // connection before a client uploading at the boundary receives the response (413, 400 or 404).
        var bytes=request.getInputStream().readNBytes(LIMIT+1);
        var found=check(project,version,user,element);
        if(name.isBlank() || name.length()>255 || name.contains("/") || name.contains("\\") || name.chars().anyMatch(Character::isISOControl))throw new IllegalArgumentException();
        if(bytes.length>LIMIT)throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"El máximo por ficha es 4 MiB.");
        if(bytes.length<8 || !new String(bytes,0,5,java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-"))
            throw new IllegalArgumentException("El archivo debe tener una cabecera PDF válida.");
        // The GlobalId must be one of this revision's elements: a sheet is never linked to a piece the IFC lacks.
        if("IFC".equals(found.format()))try(var ifc=versions.storage().read(project,version)){
            if(!ElementIdentity.declares(ifc,element))
                throw new InvalidRequestApplicationException("ELEMENT_NOT_IN_VERSION","El GlobalId no existe en esta versión del IFC.");
        }
        String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        db.queryForObject("select id from model_version where id=? for update",UUID.class,version);
        var existing=db.query("""
            select id,filename,index_status,index_error,original is not null from element_specification
            where version_id=? and element_key=? and sha256=?
            """,SpecificationController::document,version,element,hash);
        if(!existing.isEmpty() && !"FAILED".equals(existing.getFirst().status()))return existing.getFirst();
        var id=existing.isEmpty()?UUID.randomUUID():existing.getFirst().id();
        indexer.stage(id,bytes);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) {
                if(status!=STATUS_COMMITTED)try{indexer.remove(id);}catch(IOException ignored){/* Periodic cleanup retries. */}
            }
        });
        if(existing.isEmpty())
            db.update("""
                insert into element_specification(id,version_id,element_key,filename,sha256,index_status,uploaded_by)
                values(?,?,?,?,?,'QUEUED',?)
                """,id,version,element,name,hash,user);
        else db.update("update element_specification set filename=?,index_status='QUEUED',index_error=null,created_at=current_timestamp where id=?",name,id);
        return new Document(id,name,"QUEUED",null,false);
    }
    @GetMapping @Transactional(readOnly=true)
    public Evidence read(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestParam String element,@RequestParam(defaultValue="acabado") String q){
        check(project,version,user,element);
        if(q.length()>160)throw new IllegalArgumentException();
        var docs=db.query("""
            select id,filename,index_status,index_error,original is not null from element_specification
            where version_id=? and element_key=? order by filename,id
            """,SpecificationController::document,version,element);
        var pages=db.query("select d.id,d.filename,p.page_number,p.content from element_specification d join specification_page p on p.document_id=d.id where d.version_id=? and d.element_key=? order by d.id,p.page_number",(r,n)->new SpecificationSearch.Page(r.getObject(1,UUID.class),r.getString(2),r.getInt(3),r.getString(4)),version,element);
        return new Evidence(docs,SpecificationSearch.find(pages,q));
    }
    @GetMapping("/{id}") @Transactional(readOnly=true)
    public ResponseEntity<byte[]> original(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id){
        versions.get(project,user,version);
        var rows=db.query("select original from element_specification where version_id=? and id=? and original is not null",(r,n)->r.getBytes(1),version,id);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_PDF).body(rows.stream().findFirst().orElseThrow(NotFoundApplicationException::new));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,String>> status(ResponseStatusException exception){
        var response=ResponseEntity.status(exception.getStatusCode());
        if(exception.getStatusCode().value()==413)response.header(HttpHeaders.CONNECTION,"close");
        return response.body(Map.of("message",Objects.requireNonNullElse(exception.getReason(),"No se pudo recibir el PDF.")));
    }
}
