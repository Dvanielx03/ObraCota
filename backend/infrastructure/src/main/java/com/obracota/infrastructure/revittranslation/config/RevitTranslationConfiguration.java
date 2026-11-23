package com.obracota.infrastructure.revittranslation.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.application.revittranslation.port.RevitTranslationPort;
import com.obracota.application.revittranslation.usecase.RevitTranslations;
import com.obracota.domain.revittranslation.port.RevitTranslationRepository;
import com.obracota.infrastructure.revittranslation.adapters.out.aps.ApsModelDerivative;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;

/**
 * Autodesk Model Derivative, off until APS_CLIENT_ID and APS_CLIENT_SECRET are set. The conversions run on two
 * threads of their own (not a bean: a bean {@code Executor} would replace Spring's task executor).
 */
@Configuration
public class RevitTranslationConfiguration {
    @Bean RevitTranslationPort apsModelDerivative(ObjectMapper json, @Value("${APS_CLIENT_ID:}") String clientId,
            @Value("${APS_CLIENT_SECRET:}") String clientSecret, @Value("${APS_BUCKET:}") String bucket) {
        return new ApsModelDerivative(json, clientId, clientSecret, bucket, URI.create("https://developer.api.autodesk.com/"),
            Duration.ofSeconds(5), Duration.ofMinutes(30));
    }

    @Bean RevitTranslations revitTranslations(ProjectVersions versions, RevitTranslationRepository translations,
            RevitTranslationPort service, Transactions tx, Clock clock) {
        var count = new AtomicInteger();
        var pool = Executors.newFixedThreadPool(2, task -> {
            var thread = new Thread(task, "revit-translation-" + count.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
        return new RevitTranslations(versions, translations, service, tx, pool, clock);
    }

    /** A conversion running when the server stopped has no worker left: it is marked failed. */
    @EventListener(ApplicationReadyEvent.class)
    public void failInterrupted(ApplicationReadyEvent event) {
        event.getApplicationContext().getBean(RevitTranslations.class).interrupted();
    }
}
