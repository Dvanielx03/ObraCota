package com.obracota.infrastructure.knowledge.adapters.out;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.knowledge.port.SpecificationPassages;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@link SpecificationPassages} on PostgreSQL with pgvector: {@code specification_passage} holds 1,400-character
 * passages every 1,200 characters, ranked by reciprocal rank fusion of {@code ts_rank} and cosine distance.
 */
public class PassageAdapter implements SpecificationPassages {
    private static final String SOURCES = """
        select d.id,d.filename,v.id,v.name,v.revision,d.element_key,d.index_status,d.index_error,d.original is not null,d.ocr_pages
        from element_specification d
        join model_version v on d.version_id=v.id join model_file f on v.file_id=f.id where f.project_id=?
        """;
    private static final String LEX = "ts_rank(words,to_tsquery('simple',array_to_string(tsvector_to_array(to_tsvector('simple',?)),' | ')))";

    private final JdbcTemplate db;
    private final ObjectMapper json;

    public PassageAdapter(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    @Override
    public List<Source> sources(UUID project) {
        return db.query(SOURCES + " order by v.name,v.revision desc,d.filename,d.id", (r, n) -> new Source(
            r.getObject(1, UUID.class), r.getString(2), r.getObject(3, UUID.class), r.getString(4), r.getInt(5), r.getString(6),
            r.getString(7), r.getString(8), r.getBoolean(9), r.getInt(10)), project);
    }

    @Override
    public boolean belongs(UUID project, UUID document) {
        return !db.query(SOURCES + " and d.id=?", (r, n) -> r.getString(1), project, document).isEmpty();
    }

    @Override public Index index(UUID document) {
        return db.queryForObject("select index_status,index_model from element_specification where id=?",
            (row,n) -> new Index(row.getString(1),row.getString(2)),document);
    }

    @Override
    public List<Map<String, Object>> history(UUID document) {
        return db.queryForList("select question,result from document_answer where document_id=? and result is not null order by created_at desc limit 10", document);
    }

    @Override
    public int split(UUID document) {
        db.update("""
            insert into specification_passage(document_id,page_number,offset_chars,content)
            select document_id,page_number,pos,substr(content,pos,1400) from specification_page
            cross join lateral generate_series(1,length(content),1200) pos where document_id=? on conflict do nothing
            """, document);
        return db.queryForObject("select count(*) from specification_passage where document_id=?", Integer.class, document);
    }

    @Override
    public void ask(UUID id, UUID document, String question) {
        db.update("insert into document_answer values(?,?,?,null,current_timestamp)", id, document, question);
    }

    @Override
    public List<Passage> unembedded(UUID document, String model, String question) {
        return db.query("select page_number,offset_chars,content from specification_passage where document_id=? and (embedding is null or embedding_model<>?) order by " + LEX + " desc,page_number,offset_chars limit 16",
            (r, n) -> new Passage(r.getInt(1), r.getInt(2), r.getString(3)), document, model, question);
    }

    @Override
    public void embed(UUID document, Passage passage, float[] vector, String model) {
        db.update("update specification_passage set embedding=?::vector,embedding_model=? where document_id=? and page_number=? and offset_chars=?",
            Arrays.toString(vector), model, document, passage.page(), passage.offset());
    }

    @Override
    public List<Passage> ranked(UUID document, String question, String model, float[] vector) {
        return db.query("""
            with scores as (select page_number,offset_chars,content, %s as lexical,
            case when embedding_model=? then embedding <=> ?::vector end as distance
            from specification_passage where document_id=?), ranked as (
            select *, rank() over(order by lexical desc) as lr,rank() over(order by distance nulls last) as vr from scores)
            select ranked.page_number,offset_chars,ranked.content,p.section_title from ranked
            left join specification_page p on p.document_id=? and p.page_number=ranked.page_number
            where lexical>0 or distance is not null
            order by (case when lexical>0 then 1.0/(60+lr) else 0 end + case when distance is not null then 1.0/(60+vr) else 0 end) desc,
                ranked.page_number,offset_chars limit 6
            """.formatted(LEX), (r, n) -> new Passage(r.getInt(1), r.getInt(2), r.getString(3),r.getString(4)),
            question, model, vector == null ? null : Arrays.toString(vector), document,document);
    }

    @Override
    public void answer(UUID id, Answer answer) {
        try {
            db.update("update document_answer set result=? where id=?", json.writeValueAsString(answer), id);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The answer could not be written as JSON", e);
        }
    }
}
