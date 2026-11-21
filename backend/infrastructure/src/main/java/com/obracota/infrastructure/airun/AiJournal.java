package com.obracota.infrastructure.airun;
import com.obracota.application.designoption.GenerateOptions;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.ImageGenerationPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.UUID;

@Repository
public class AiJournal implements GenerateOptions.Journal {
    private final JdbcTemplate db;
    public AiJournal(JdbcTemplate db) {this.db=db;}
    public UUID start(UUID batch,int slot,String model) {
        UUID id=UUID.randomUUID();
        db.update("insert into ai_run(id,batch_id,slot,model_id,status,created_at) values(?,?,?,?,'RUNNING',current_timestamp)",id,batch,slot,model);
        return id;
    }
    public void finish(UUID run,Consumption u) {
        db.update("update ai_run set status='DONE', input_tokens=?,output_tokens=?,total_tokens=? where id=?",u.inputTokens(),u.outputTokens(),u.totalTokens(),run);
    }
    public void fail(UUID run,String error,Consumption u) {
        db.update("update ai_run set status='FAILED',error_code=?,input_tokens=?,output_tokens=?,total_tokens=? where id=?",error,u.inputTokens(),u.outputTokens(),u.totalTokens(),run);
    }
    public void save(UUID batch,int slot,String description,ImageGenerationPort.Image image) {
        db.update("insert into design_option(batch_id,slot,description,image_bytes,mime) values(?,?,?,?,?)",batch,slot,description,image.bytes(),image.mime());
    }
    public void end(UUID batch,boolean success) {
        db.update("update design_option_batch set state=? where id=?",success?"READY":"FAILED",batch);
    }
    @org.springframework.transaction.annotation.Transactional
    public void describe(UUID batch,java.util.List<String> variants) {
        for(int i=0;i<variants.size();i++)
            db.update("insert into design_option_description values(?,?,?)",batch,i+1,variants.get(i));
    }
}
