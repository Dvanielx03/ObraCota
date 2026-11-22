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
    @Test void acceptsManufacturerMeshesAndKeepsOtherExchangeFormatsOut() {
        assertEquals("FBX",ModelFile.formatOf("PK60.FBX"));
        assertEquals("FBX",ModelFile.formatOf("Furniture_Fritz-Hansen_Basket.fbx"));
        assertEquals("OBJ",ModelFile.formatOf("CM21 - Essay Table.obj"));
        for(String name:new String[]{"PK60.skp","PK60.max","PK60.rfa","PK60.mtl","PK60.3ds","fbx","Silla.obj.zip"})
            assertThrows(IllegalArgumentException.class,()->ModelFile.formatOf(name),name);
    }
}
