package com.obracota.infrastructure.modelchange.config;

import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.application.modelchange.usecase.ModelReading;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.application.modelchange.usecase.VersionPrices;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.designchange.BimEditPort;
import com.obracota.domain.modelchange.port.*;
import com.obracota.domain.modelversion.port.VersionRepository;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import com.obracota.infrastructure.modelchange.adapters.out.persistence.ModelChangeAdapter;
import com.obracota.infrastructure.modelchange.adapters.out.persistence.PriceBookAdapter;
import com.obracota.infrastructure.modelchange.adapters.out.storage.PreviewSweeper;
import com.obracota.infrastructure.modelchange.adapters.out.storage.PreviewVolumeStorage;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Beans of the model change module. The use cases live outside the scanned packages and are registered here; the
 * engine adapter ({@code IfcEngineHttpAdapter}) is a package-private {@code @Component}, like {@code HttpBimEdit}.
 */
@Configuration
public class ModelChangeConfiguration {
    @Bean Clock modelChangeClock() { return Clock.systemUTC(); }

    @Bean JacksonRecipeCodec recipeCodec() { return new JacksonRecipeCodec(); }

    @Bean ModelChangeAdapter modelChangeRepository(JdbcTemplate db, RecipeCodec recipes) { return new ModelChangeAdapter(db, recipes); }

    @Bean PriceBookAdapter priceBook(JdbcTemplate db) { return new PriceBookAdapter(db); }

    @Bean PreviewVolumeStorage previewStorage(@Value("${models.directory:/srv/originals}") Path directory) {
        return new PreviewVolumeStorage(directory.resolve(".previews"));
    }

    @Bean PreviewSweeper previewSweeper(PreviewVolumeStorage storage, ModelChangeRepository changes, VersionRepository versions,
                                        Transactions tx, Clock clock) {
        return new PreviewSweeper(storage, changes, versions, tx, clock);
    }

    @Bean ModelChanges modelChanges(ProjectVersions versions, ModelChangeRepository changes, PriceBook prices, PreviewStorage previews,
                                    ModelEnginePort engine, BimEditPort doors, RecipeCodec recipes, Transactions tx, Clock clock,
                                    @Value("${ifc.engine.request-budget:PT200S}") Duration budget) {
        return new ModelChanges(versions, changes, prices, previews, engine, doors, recipes, tx, clock, budget);
    }

    @Bean PublishModelChange publishModelChange(ProjectVersions versions, ModelChangeRepository changes, PriceBook prices,
                                                PreviewStorage previews, RecipeCodec recipes, Transactions tx, Clock clock) {
        return new PublishModelChange(versions, changes, prices, previews, recipes, tx, clock);
    }

    @Bean VersionPrices versionPrices(ProjectVersions versions, PriceBook prices, Transactions tx) {
        return new VersionPrices(versions, prices, tx);
    }

    @Bean ModelReading modelReading(ProjectVersions versions, ModelEnginePort engine) { return new ModelReading(versions, engine); }
}
