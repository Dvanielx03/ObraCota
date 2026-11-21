package com.obracota.infrastructure.modelfile.adapters.out.persistence;

import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.domain.modelfile.port.repository.ModelFileRepository;
import com.obracota.infrastructure.modelfile.adapters.out.persistence.entity.ModelFileJpaEntity;
import com.obracota.infrastructure.modelfile.adapters.out.persistence.repository.ModelFileJpaRepository;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class ModelFileAdapter implements ModelFileRepository {
    private final ModelFileJpaRepository rows;
    public ModelFileAdapter(ModelFileJpaRepository rows) { this.rows=rows; }
    public void add(ModelFile f) { rows.saveAndFlush(new ModelFileJpaEntity(f)); }
    public Optional<ModelFile> find(UUID p,UUID id) { return rows.findByProjectIdAndId(p,id).map(ModelFileJpaEntity::toDomain); }
    public Optional<ModelFile> named(UUID p,String name) { return rows.findByProjectIdAndName(p,name).map(ModelFileJpaEntity::toDomain); }
    public List<ModelFile> list(UUID p) { return rows.findAllByProjectIdOrderByName(p).stream().map(ModelFileJpaEntity::toDomain).toList(); }
}
