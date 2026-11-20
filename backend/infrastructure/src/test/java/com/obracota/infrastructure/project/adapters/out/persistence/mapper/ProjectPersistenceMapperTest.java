package com.obracota.infrastructure.project.adapters.out.persistence.mapper;

import com.obracota.domain.project.model.aggregate.Project;
import com.obracota.domain.security.model.UserId;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ProjectPersistenceMapperTest {
    @Test void roundTripKeepsIdentityAndDoesNotReplayEvents() {
        var original=Project.register(UserId.generate(),"  Piscina  ");
        var mapper=new ProjectPersistenceMapper();
        var entity=mapper.toNewEntity(original);
        var restored=mapper.toDomain(entity);
        assertEquals(original.id(),restored.id());
        assertEquals(original.owner(),restored.owner());
        assertEquals("Piscina",restored.name());
        assertTrue(restored.domainEvents().isEmpty());
        restored.rename("Piscina norte");
        mapper.synchronize(restored,entity);
        assertEquals("Piscina norte",entity.name);
    }
}
