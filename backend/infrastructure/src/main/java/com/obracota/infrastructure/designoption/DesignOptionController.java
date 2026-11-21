package com.obracota.infrastructure.designoption;

import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.infrastructure.assistant.adapters.out.ai.GeminiModels;
import com.obracota.infrastructure.common.exception.ErrorResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.*;
import java.util.*;
import javax.imageio.ImageIO;
import java.io.*;

@RestController @RequestMapping("/api/projects/{project}/versions/{version}/options")
public class DesignOptionController {
    private final ProjectVersions versions;
    private final JdbcTemplate db;
    private final GeminiModels gemini;
    private final int cap;
    public DesignOptionController(ProjectVersions versions,JdbcTemplate db,GeminiModels gemini,
            @Value("${AI_MONTHLY_LIMIT_CENTS:1000}") int cap) {
        this.versions=versions;this.db=db;this.gemini=gemini;this.cap=cap;
    }
    public record Input(UUID id,String element,String name,String request,String jpeg,String mask) {}
    private boolean valid(String value,int max) {return value!=null && !value.isBlank() && value.length()<=max;}
    private byte[] screenshot(String encoded) {
        if(!valid(encoded,1_500_000)) throw new IllegalArgumentException();
        byte[] bytes=Base64.getDecoder().decode(encoded);
        try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers=ImageIO.getImageReaders(stream);
            if(!readers.hasNext()) throw new IllegalArgumentException();
            var reader=readers.next();
            try {
                reader.setInput(stream);
                if(!reader.getFormatName().equalsIgnoreCase("JPEG") || reader.getWidth(0)>1280 || reader.getHeight(0)>1280)
                    throw new IllegalArgumentException();
                reader.read(0);
            } finally {reader.dispose();}
        } catch(IOException e) {throw new IllegalArgumentException();}
        return bytes;
    }
    private void within(UUID version,UUID id) {
        if(db.queryForList("select id from design_option_batch where version_id=? and id=?",UUID.class,version,id).isEmpty())
            throw new NotFoundApplicationException();
    }
    @GetMapping @Transactional(readOnly=true)
    public Map<String,Object> list(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestParam String element) {
        versions.get(project,user,version);
        var batches=db.query("select id,description,state,selected_slot from design_option_batch where version_id=? and element_key=? order by created_at desc",
            (r,n)->{var b=new LinkedHashMap<String,Object>(); b.put("id",r.getString(1));b.put("request",r.getString(2));b.put("state",r.getString(3));b.put("selected",r.getObject(4));return b;},version,element);
        for(var b:batches) {
            UUID id=UUID.fromString((String)b.get("id"));
            b.put("drafts",db.queryForList("select description from design_option_description where batch_id=? order by slot",String.class,id));
            b.put("options",db.query("select slot,description from design_option where batch_id=? order by slot",(r,n)->Map.of("slot",r.getInt(1),"description",r.getString(2)),id));
            b.put("runs",db.queryForList("select slot, model_id, status, error_code, input_tokens,output_tokens,total_tokens from ai_run where batch_id=? order by slot",id));
        }
        return Map.of("available",gemini.configured(),"batches",batches);
    }
    @PostMapping @Transactional @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,UUID> submit(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestBody Input input) {
        versions.get(project,user,version);
        if(input.id()==null || !valid(input.element(),512) || !valid(input.name(),512) || !valid(input.request(),2000)) throw new IllegalArgumentException();
        if(!gemini.configured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Falta configurar Gemini en el servidor.");
        byte[] bytes=screenshot(input.jpeg());
        byte[] mask=input.mask()==null?null:screenshot(input.mask());
        db.queryForObject("select id from ai_budget_lock where id=1 for update",Integer.class);
        if(!db.queryForList("select id from design_option_batch where id=? and version_id=? and owner_id=? and element_key=? and description=?",UUID.class,input.id(),version,user,input.element(),input.request()).isEmpty()) return Map.of("id",input.id());
        String month=YearMonth.now(ZoneOffset.UTC).toString();
        var used=db.queryForList("select reserved_cents from ai_month_budget where month_key=?",Integer.class,month);
        int reserved=used.isEmpty()?0:used.getFirst();
        if(cap-reserved<100) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Se alcanzó el presupuesto mensual de opciones.");
        if(used.isEmpty()) db.update("insert into ai_month_budget values(?,100)",month);
        else db.update("update ai_month_budget set reserved_cents=reserved_cents+100 where month_key=?",month);
        db.update("insert into design_option_batch(id,version_id,owner_id,element_key,element_name,description,captured,state,created_at) values(?,?,?,?,?,?,?,'QUEUED',current_timestamp)",
                input.id(),version,user,input.element(),input.name(),input.request(),bytes);
        if(mask!=null)db.update("update design_option_batch set selection_mask=? where id=?",mask,input.id());
        return Map.of("id",input.id());
    }
    @GetMapping("/{id}/images/{slot}") @Transactional(readOnly=true)
    public ResponseEntity<byte[]> image(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id,@PathVariable int slot) {
        versions.get(project,user,version); within(version,id);
        var result=slot==0 ? db.query("select captured,'image/jpeg' from design_option_batch where id=?",this::binary,id)
            :db.query("select image_bytes,mime from design_option where batch_id=? and slot=?",this::binary,id,slot);
        return result.stream().findFirst().orElseThrow(NotFoundApplicationException::new);
    }
    private ResponseEntity<byte[]> binary(java.sql.ResultSet r,int n) throws java.sql.SQLException {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(r.getString(2))).body(r.getBytes(1));
    }
    @PutMapping("/{id}/selection/{slot}") @Transactional @ResponseStatus(HttpStatus.NO_CONTENT)
    public void select(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id,@PathVariable int slot) {
        versions.get(project,user,version); within(version,id);
        if(slot<1 || slot>3 || db.update("update design_option_batch set selected_slot=?,selected_at=current_timestamp where id=? and state='READY' and exists(select 1 from design_option where batch_id=? and slot=?)",slot,id,id,slot)!=1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"La terna aún no está completa.");
    }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ErrorResponse> problem(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(new ErrorResponse(e.getReason()));
    }
}
