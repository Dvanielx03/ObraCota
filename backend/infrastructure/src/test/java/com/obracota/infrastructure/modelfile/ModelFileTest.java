package com.obracota.infrastructure.modelfile;

import com.obracota.domain.modelfile.model.ModelFile;
import com.obracota.infrastructure.modelfile.adapters.out.persistence.entity.ModelFileJpaEntity;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class ModelFileTest {
    @Test void preservesIdentityAndRejectsInvalidNames() {
        var file=ModelFile.register(UUID.randomUUID(),"Plano.dWg");
        assertEquals("DWG",file.format());
        assertEquals(file,new ModelFileJpaEntity(file).toDomain());
        assertThrows(IllegalArgumentException.class,()->ModelFile.formatOf("../Plano.dwg"));
        assertThrows(IllegalArgumentException.class,()->ModelFile.formatOf("Plano.rvt"));
    }
}
