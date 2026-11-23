package com.obracota.infrastructure.revittranslation.adapters.out.persistence;

import com.obracota.domain.revittranslation.model.RevitTranslation;
import com.obracota.domain.revittranslation.model.RevitTranslation.Status;
import com.obracota.domain.revittranslation.port.RevitTranslationRepository;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Repository;

@Repository
public class RevitTranslationAdapter implements RevitTranslationRepository {
    @PersistenceContext private EntityManager db;
    public void save(RevitTranslation translation) {
        db.merge(new RevitTranslationRow(translation));
        db.flush();
    }
    public Optional<RevitTranslation> latest(UUID version) {
        return db.createQuery("from RevitTranslationRow where versionId=:version order by createdAt desc",RevitTranslationRow.class)
            .setParameter("version",version).setMaxResults(1).getResultList().stream().findFirst().map(RevitTranslationRow::toDomain);
    }
    public int failRunning(String message, Instant now) {
        return db.createQuery("update RevitTranslationRow set status=:failed, message=:message, updatedAt=:now where status not in (:done,:failed)")
            .setParameter("failed",Status.FAILED).setParameter("done",Status.DONE)
            .setParameter("message",message).setParameter("now",now).executeUpdate();
    }
}
