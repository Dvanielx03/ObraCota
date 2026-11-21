package com.obracota.infrastructure.knowledge;

import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.knowledge.SpecificationSearch;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
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
    private static final int LIMIT=4*1024*1024;
    public SpecificationController(ProjectVersions versions,JdbcTemplate db){this.versions=versions;this.db=db;}
    public record Document(UUID id,String filename){}
    public record Evidence(List<Document> documents,List<SpecificationSearch.Citation> citations){}
    private void check(UUID project,UUID version,UUID user,String element){
        versions.get(project,user,version);
        if(element.isBlank() || element.length()>512)throw new IllegalArgumentException();
    }
    @PostMapping(consumes="application/pdf") @Transactional
    public Document attach(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,
        @RequestParam String element,@RequestParam String name,HttpServletRequest request) throws IOException,NoSuchAlgorithmException {
        check(project,version,user,element);
        if(name.isBlank() || name.length()>255 || name.contains("/") || name.contains("\\") || name.chars().anyMatch(Character::isISOControl))throw new IllegalArgumentException();
        var bytes=request.getInputStream().readNBytes(LIMIT+1);
        if(bytes.length>LIMIT)throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
        String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        db.queryForObject("select id from model_version where id=? for update",UUID.class,version);
        var existing=db.query("select id,filename from element_specification where version_id=? and element_key=? and sha256=?",(r,n)->new Document(r.getObject(1,UUID.class),r.getString(2)),version,element,hash);
        if(!existing.isEmpty())return existing.getFirst();
        var id=UUID.randomUUID();
        try(var pdf=Loader.loadPDF(bytes)){
            if(pdf.isEncrypted() || pdf.getNumberOfPages()>100 || pdf.getNumberOfPages()<1)throw new IllegalArgumentException();
            db.update("insert into element_specification values(?,?,?,?,?,?)",id,version,element,name,hash,bytes);
            var stripper=new PDFTextStripper();
            for(int page=1;page<=pdf.getNumberOfPages();page++){
                stripper.setStartPage(page);stripper.setEndPage(page);
                String text=stripper.getText(pdf).replaceAll("[\\p{Cntrl}\\s]+"," ").strip();
                if(!text.isEmpty())db.update("insert into specification_page values(?,?,?)",id,page,text);
            }
        }catch(IOException e){throw new IllegalArgumentException("PDF ilegible",e);}
        return new Document(id,name);
    }
    @GetMapping @Transactional(readOnly=true)
    public Evidence read(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestParam String element,@RequestParam(defaultValue="acabado") String q){
        check(project,version,user,element);
        if(q.length()>160)throw new IllegalArgumentException();
        var docs=db.query("select id,filename from element_specification where version_id=? and element_key=? order by filename,id",(r,n)->new Document(r.getObject(1,UUID.class),r.getString(2)),version,element);
        var pages=db.query("select d.id,d.filename,p.page_number,p.content from element_specification d join specification_page p on p.document_id=d.id where d.version_id=? and d.element_key=? order by d.id,p.page_number",(r,n)->new SpecificationSearch.Page(r.getObject(1,UUID.class),r.getString(2),r.getInt(3),r.getString(4)),version,element);
        return new Evidence(docs,SpecificationSearch.find(pages,q));
    }
    @GetMapping("/{id}") @Transactional(readOnly=true)
    public ResponseEntity<byte[]> original(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id){
        versions.get(project,user,version);
        var rows=db.query("select original from element_specification where version_id=? and id=?",(r,n)->r.getBytes(1),version,id);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_PDF).body(rows.stream().findFirst().orElseThrow(NotFoundApplicationException::new));
    }
}
