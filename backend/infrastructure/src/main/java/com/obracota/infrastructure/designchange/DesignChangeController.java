package com.obracota.infrastructure.designchange;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.NotFoundApplicationException;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.rulefinding.DoorRules;
import com.obracota.domain.designchange.BimEditPort;
import com.obracota.domain.modelversion.model.ModelVersion;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.io.*;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/api/projects/{project}/design-changes")
public class DesignChangeController {
    private final ProjectVersions versions;
    private final BimEditPort engine;
    private final JdbcTemplate db;
    private final ObjectMapper json;

    public DesignChangeController(ProjectVersions versions, BimEditPort engine, JdbcTemplate db, ObjectMapper json) {
        this.versions=versions;this.engine=engine;this.db=db;this.json=json;
    }

    public record Price(String typeId, BigDecimal amount, String source, LocalDate date) {}
    public record Pricing(BigDecimal minimum, List<Price> prices) {}
    public record Estimate(int beforeQuantity, int afterQuantity, Price before, Price after, BigDecimal difference) {}
    public record Review(BimEditPort.Door door, BimEditPort.DoorType proposal, List<DoorRules.Finding> findings, Estimate estimate) {}
    public record Proposal(UUID version, String element, String typeId, String description, String picture) {}
    public record Change(UUID id, UUID version, String description, Review review, UUID applied, UUID restored, boolean picture) {}

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,String>> conflict(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", Objects.requireNonNullElse(error.getReason(),"No se pudo completar el cambio.")));
    }

    @GetMapping("/door")
    public BimEditPort.Door door(@PathVariable UUID project,@AuthenticationPrincipal UUID user,
            @RequestParam UUID version,@RequestParam String element) throws IOException {
        requireIfc(project,user,version);
        return engine.inspect(project,version,guid(element));
    }

    @GetMapping("/pricing")
    public Pricing prices(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestParam UUID version) {
        requireIfc(project,user,version);
        return pricing(project,version);
    }

    private Pricing pricing(UUID project,UUID version) {
        var limits=db.queryForList("select width_m from door_project_minimum where project_id=?",BigDecimal.class,project);
        var prices=db.query("select type_key,amount,source,price_date from door_unit_price where project_id=? and version_id=?",
            (rs,index)->new Price(rs.getString(1),rs.getBigDecimal(2),rs.getString(3),rs.getObject(4,LocalDate.class)),project,version);
        return new Pricing(limits.isEmpty()?null:limits.getFirst(),prices);
    }

    @PutMapping("/pricing")
    @Transactional
    public Pricing savePricing(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestParam UUID version,
            @RequestBody Pricing input) {
        requireIfc(project,user,version);versions.catalog().requireOwnerForUpdate(project,user);
        if(input.minimum()!=null) {
            if(input.minimum().signum()<=0 || input.minimum().compareTo(BigDecimal.TEN)>0 || input.minimum().scale()>6)
                throw new IllegalArgumentException();
            db.update("delete from door_project_minimum where project_id=?",project);
            db.update("insert into door_project_minimum values(?,?)",project,input.minimum());
        }
        if(input.prices()!=null){
            if(input.prices().size()>20)throw new IllegalArgumentException();
            for(var price:input.prices()){
                guid(price.typeId());
                if(price.amount()==null || price.amount().signum()<0 || price.amount().scale()>2 ||
                    price.amount().precision()>16 || price.source()==null || price.source().isBlank() ||
                    price.source().length()>300 || price.date()==null)throw new IllegalArgumentException();
                db.update("delete from door_unit_price where project_id=? and version_id=? and type_key=?",project,version,price.typeId());
                db.update("insert into door_unit_price values(?,?,?,?,?,?)",project,version,price.typeId(),price.amount(),price.source().strip(),price.date());
            }
        }
        return pricing(project,version);
    }

    @GetMapping("/review")
    public Review review(@PathVariable UUID project,@AuthenticationPrincipal UUID user,
                         @RequestParam UUID version,@RequestParam String element,@RequestParam String typeId) throws IOException {
        return evaluate(project,version,door(project,user,version,element),guid(typeId));
    }

    private Review evaluate(UUID project,UUID version,BimEditPort.Door door,String typeId) {
        var type=door.options().stream().filter(p->p.id().equals(typeId)).findFirst()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"El tipo no está disponible en este IFC."));
        var pricing=pricing(project,version);
        var before=pricing.prices().stream().filter(p->p.typeId().equals(door.typeId())).findFirst().orElse(null);
        var after=pricing.prices().stream().filter(p->p.typeId().equals(typeId)).findFirst().orElse(null);
        var estimate=new Estimate(1,1,before,after,before==null||after==null?null:after.amount().subtract(before.amount()));
        return new Review(door,type,DoorRules.evaluate(door,type,pricing.minimum()),estimate);
    }

    @PostMapping
    @Transactional(rollbackFor=IOException.class)
    @ResponseStatus(HttpStatus.CREATED)
    public Change propose(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestBody Proposal input) throws IOException {
        if(input.description()==null || input.description().isBlank() || input.description().length()>2000)throw new IllegalArgumentException();
        var review=review(project,user,input.version(),input.element(),input.typeId());
        UUID id=UUID.randomUUID();
        db.update("""
            insert into door_change(id,project_id,base_version,author_id,element_key,type_key,description,picture,review,created_at)
            values(?,?,?,?,?,?,?,?,?,current_timestamp)
            """,id,project,input.version(),user,input.element(),input.typeId(),input.description().strip(),picture(input.picture()),json.writeValueAsString(review));
        return change(project,id);
    }

    @GetMapping
    public List<Change> list(@PathVariable UUID project,@AuthenticationPrincipal UUID user) {
        versions.catalog().requireOwner(project,user);
        return db.query(QUERY+" order by created_at desc",this::row,project);
    }

    private static final String QUERY="""
        select id,base_version,description,review,applied_version,restored_version,
        case when picture is null then false else true end as picture_present from door_change where project_id=?
        """;
    private Change change(UUID project,UUID id) {
        return db.query(QUERY+" and id=?",this::row,project,id).stream().findFirst().orElseThrow(NotFoundApplicationException::new);
    }
    private Change row(ResultSet rs,int index) throws SQLException {
        try {
            return new Change(rs.getObject(1,UUID.class),rs.getObject(2,UUID.class),rs.getString(3),json.readValue(rs.getString(4),Review.class),
                rs.getObject(5,UUID.class),rs.getObject(6,UUID.class),rs.getBoolean(7));
        } catch(JsonProcessingException e) {throw new SQLException(e);}
    }

    @GetMapping("/{id}/picture")
    public ResponseEntity<byte[]> illustration(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user) {
        versions.catalog().requireOwner(project,user);
        var bytes=db.query("select picture from door_change where project_id=? and id=? and picture is not null",
            (rs,index)->rs.getBytes(1),project,id).stream().findFirst().orElseThrow(NotFoundApplicationException::new);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).body(bytes);
    }

    @PostMapping("/{id}/apply")
    @Transactional(rollbackFor=IOException.class)
    public Change apply(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user) throws IOException {
        versions.catalog().requireOwnerForUpdate(project,user);
        var change=change(project,id);
        if(change.applied()!=null)return change;
        var base=requireIfc(project,user,change.version());
        requireLatest(project,user,base);
        try(var revised=engine.apply(project,base.id(),change.review().door().element(),change.review().proposal().id())){
            var version=versions.upload(project,user,base.fileId(),base.name(),-1,revised);
            db.update("update door_change set applied_version=?,applied_at=current_timestamp where id=?",version.id(),id);
        }
        return change(project,id);
    }

    @PostMapping("/{id}/restore")
    @Transactional(rollbackFor=IOException.class)
    public Change restore(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user) throws IOException {
        versions.catalog().requireOwnerForUpdate(project,user);
        var change=change(project,id);
        if(change.restored()!=null)return change;
        if(change.applied()==null)throw new ResponseStatusException(HttpStatus.CONFLICT,"Todavía no se aplicó el cambio.");
        requireLatest(project,user,versions.get(project,user,change.applied()));
        var base=versions.get(project,user,change.version());
        try(var original=versions.storage().read(project,base.id())){
            var revision=versions.upload(project,user,base.fileId(),base.name(),base.byteSize(),original);
            db.update("update door_change set restored_version=? where id=?",revision.id(),id);
        }
        return change(project,id);
    }

    private void requireLatest(UUID project,UUID user,ModelVersion base){
        if(!versions.list(project,user,base.fileId()).getFirst().id().equals(base.id()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Abre la revisión más reciente para proponer o revertir un cambio.");
    }
    private ModelVersion requireIfc(UUID project,UUID user,UUID version){
        var model=versions.get(project,user,version);
        if(!"IFC".equals(model.format()))throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Selecciona una versión IFC.");
        return model;
    }
    private static String guid(String key){
        if(key==null || !key.matches("[0-9A-Za-z_$]{22}"))throw new IllegalArgumentException();
        return key;
    }
    private static byte[] picture(String data){
        if(data==null || data.isBlank())return null;
        if(data.length()>6_000_000)throw new IllegalArgumentException();
        byte[] bytes=Base64.getDecoder().decode(data);
        byte[] signature={(byte)137,80,78,71,13,10,26,10};
        if(bytes.length<24 || !Arrays.equals(Arrays.copyOf(bytes,8),signature))throw new IllegalArgumentException();
        return bytes;
    }
}
