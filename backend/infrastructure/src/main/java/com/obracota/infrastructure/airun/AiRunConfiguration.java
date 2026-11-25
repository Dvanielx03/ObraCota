package com.obracota.infrastructure.airun;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.airun.port.AiRunJournal;
import com.obracota.application.airun.port.BudgetReservationPort;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.designoption.port.DesignOptionBatches;
import com.obracota.application.designoption.usecase.DesignOptions;
import com.obracota.application.designoption.usecase.Panoramas;
import com.obracota.domain.assistant.port.service.ImageGenerationPort;
import com.obracota.application.knowledge.port.CitationCodec;
import com.obracota.application.knowledge.port.SpecificationPassages;
import com.obracota.application.knowledge.usecase.AskDocument;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.infrastructure.aimodel.ModelCatalog;
import com.obracota.infrastructure.designoption.adapters.out.DesignOptionBatchAdapter;
import com.obracota.infrastructure.knowledge.adapters.out.JacksonCitationCodec;
import com.obracota.infrastructure.knowledge.adapters.out.PassageAdapter;
import com.obracota.infrastructure.knowledge.adapters.out.LocalDocumentModels;
import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Beans of the paid AI features: the single monthly budget and the two use cases that spend it. The UTC clock is built
 * here and not exposed as a bean, so it does not compete with the model change clock.
 */
@Configuration
@EnableConfigurationProperties(AiBudgetProperties.class)
public class AiRunConfiguration {
    @Bean BudgetReservationPort budgetReservation(JdbcTemplate db) { return new JdbcBudgetReservation(db); }

    @Bean AiBudget aiBudget(BudgetReservationPort reservations, AiBudgetProperties properties) {
        return new AiBudget(reservations, properties.monthlyLimitCents(), Clock.systemUTC());
    }

    @Bean DesignOptionBatchAdapter designOptionBatches(JdbcTemplate db) { return new DesignOptionBatchAdapter(db); }

    @Bean DesignOptions designOptions(ProjectVersions versions, DesignOptionBatches batches, AiBudget budget, Transactions tx,
            @org.springframework.beans.factory.annotation.Value("${IMAGE_PROVIDER:gemini}") String imageProvider) {
        // Cloudflare Workers AI images are inside its free daily allowance: they reserve nothing from the paid budget.
        return new DesignOptions(versions, batches, budget, tx, "cloudflare".equals(imageProvider) ? 0 : DesignOptions.RESERVE_CENTS);
    }

    @Bean Panoramas panoramas(ProjectVersions versions, ImageGenerationPort images, AiBudget budget, Transactions tx, ModelCatalog models,
            @org.springframework.beans.factory.annotation.Value("${IMAGE_PROVIDER:gemini}") String imageProvider) {
        // Same rule as the options: a free provider reserves nothing from the monthly AI budget.
        return new Panoramas((project, user, version) -> versions.get(project, user, version), images, budget, tx,
            "cloudflare".equals(imageProvider) ? 0 : DesignOptions.RESERVE_CENTS, models.forCapability("IMAGE").id());
    }

    @Bean PassageAdapter specificationPassages(JdbcTemplate db, ObjectMapper json) { return new PassageAdapter(db, json); }

    @Bean JacksonCitationCodec citationCodec(ObjectMapper json) { return new JacksonCitationCodec(json); }

    @Bean ThreadPoolTaskScheduler documentScheduler() {
        var scheduler = new ThreadPoolTaskScheduler();
        scheduler.setThreadNamePrefix("document-index-");
        return scheduler;
    }

    @Bean ThreadPoolTaskScheduler taskScheduler() {
        return new ThreadPoolTaskScheduler();
    }

    @Bean AskDocument askDocument(ProjectFileCatalog projects, SpecificationPassages passages, CitationCodec codec,
                                  LocalDocumentModels local, AiRunJournal journal, Transactions tx) {
        return new AskDocument(projects, passages, codec, local::complete, local::embedQuery, local::embedQuery,
            journal, null, tx, LocalDocumentModels.CHAT, null);
    }
}
