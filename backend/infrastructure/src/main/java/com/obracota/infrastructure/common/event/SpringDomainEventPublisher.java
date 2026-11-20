package com.obracota.infrastructure.common.event;

import com.obracota.domain.common.event.*;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

@Component
public record SpringDomainEventPublisher(ApplicationEventPublisher publisher) implements DomainEventPublisher {
    public void publish(DomainEvent event) { publisher.publishEvent(event); }
}
