package com.obracota.domain.common.model;

import com.obracota.domain.common.event.DomainEvent;
import java.util.ArrayList;
import java.util.List;

public abstract class AggregateRoot {
    private final List<DomainEvent> events = new ArrayList<>();
    protected void record(DomainEvent event) { events.add(event); }
    public List<DomainEvent> domainEvents() { return List.copyOf(events); }
    public void clearDomainEvents() { events.clear(); }
}
