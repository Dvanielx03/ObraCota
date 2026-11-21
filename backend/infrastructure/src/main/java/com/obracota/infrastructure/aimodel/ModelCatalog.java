package com.obracota.infrastructure.aimodel;
import com.obracota.domain.aimodel.AiModel;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
@Repository
public class ModelCatalog {
    private final JdbcTemplate db;
    public ModelCatalog(JdbcTemplate db) {this.db=db;}
    public AiModel forCapability(String capability) {
        return db.queryForObject("select id,capability from ai_model where capability=?",(r,n)->new AiModel(r.getString(1),r.getString(2)),capability);
    }
}
