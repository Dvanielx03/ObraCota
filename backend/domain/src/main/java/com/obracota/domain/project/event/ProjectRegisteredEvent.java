package com.obracota.domain.project.event;

import com.obracota.domain.common.event.DomainEvent;
import com.obracota.domain.project.model.valueobject.ProjectId;
import java.time.Instant;

public record ProjectRegisteredEvent(ProjectId projectId, Instant occurredOn) implements DomainEvent {}
