package com.obracota.infrastructure.designoption;

import com.obracota.application.designoption.GenerateOptions;
import com.obracota.domain.assistant.port.service.*;
import com.obracota.infrastructure.aimodel.ModelCatalog;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.UUID;
import java.time.Instant;
import java.sql.Timestamp;

@Configuration @EnableScheduling
public class OptionJobs {
    private final JdbcTemplate db;
    private final GenerateOptions engine;
    public OptionJobs(JdbcTemplate db,ChatModelPort chat,ImageGenerationPort images,GenerateOptions.Journal journal,ModelCatalog catalog) {
        this.db=db;
        engine=new GenerateOptions(chat,images,journal,catalog.forCapability("CHAT").id(),catalog.forCapability("IMAGE").id());
    }
    @Scheduled(fixedDelay=1500,initialDelayString="${ai.queue.initial-delay:1000}")
    public void process() {
        // Four bounded provider calls. Never replay an uncertain paid call after a crash.
        var expiry=Timestamp.from(Instant.now().minusSeconds(900));
        db.update("update ai_run set status='UNKNOWN',error_code='INTERRUPTED' where status='RUNNING' and created_at<?",expiry);
        db.update("update design_option_batch set state='FAILED' where state='WORKING' and started_at<?",expiry);
        var queue=db.queryForList("select id from design_option_batch where state='QUEUED' order by created_at limit 1",UUID.class);
        if(queue.isEmpty()) return;
        var id=queue.getFirst();
        if(db.update("update design_option_batch set state='WORKING',started_at=current_timestamp where id=? and state='QUEUED'",id)!=1) return;
        record Input(String element,String description,byte[] screenshot,byte[] mask) {}
        var input=db.query("select element_name,description,captured,selection_mask from design_option_batch where id=?",(r,n)->new Input(r.getString(1),r.getString(2),r.getBytes(3),r.getBytes(4)),id);
        if(!input.isEmpty()) engine.execute(id,input.getFirst().element(),input.getFirst().description(),input.getFirst().screenshot(),input.getFirst().mask());
    }
}
