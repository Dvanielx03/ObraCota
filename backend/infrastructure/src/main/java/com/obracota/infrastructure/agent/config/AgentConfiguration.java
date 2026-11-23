package com.obracota.infrastructure.agent.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.agent.RunDesignAgent;
import com.obracota.application.agent.port.AgentToolJournal;
import com.obracota.application.agenttools.DesignAgentTools;
import com.obracota.application.airun.port.AiRunJournal;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.application.modelchange.usecase.ModelReading;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.domain.agent.port.service.AgentModelPort;
import com.obracota.infrastructure.agent.adapters.out.ai.GeminiAgentModelAdapter;
import com.obracota.infrastructure.agent.adapters.out.ai.ScriptedAgentModelAdapter;
import com.obracota.infrastructure.agent.adapters.out.persistence.JdbcAgentToolJournal;
import com.obracota.infrastructure.aimodel.ModelCatalog;
import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Beans of the design agent (H4, arquitectura A). The provider is {@code agent.provider} ({@code AGENT_PROVIDER}):
 * {@code fake} by default, so nothing calls Gemini until it is set to {@code gemini} on purpose; the profile
 * {@code agent-fake} forces the scripted model. Under the {@code test} or {@code agent-fake} profiles the Gemini
 * adapter only accepts a local endpoint. The model is {@code agent.model}, or the catalog's {@code CHAT} model.
 */
@Configuration
public class AgentConfiguration {
    @Bean AgentModelPort agentModel(ObjectMapper json, Environment env, @Value("${agent.provider:fake}") String provider,
                                    @Value("${GEMINI_API_KEY:}") String key, @Value("${agent.gemini.endpoint:}") String endpoint) {
        if ("fake".equals(provider) || env.acceptsProfiles(Profiles.of("agent-fake"))) return ScriptedAgentModelAdapter.defaultScript();
        if (!"gemini".equals(provider)) throw new IllegalStateException("agent.provider is fake or gemini, not " + provider);
        boolean localOnly = env.acceptsProfiles(Profiles.of("test", "agent-fake"));
        return new GeminiAgentModelAdapter(json, key, endpoint.isBlank() ? GeminiAgentModelAdapter.ENDPOINT : URI.create(endpoint), localOnly);
    }

    @Bean DesignAgentTools designAgentTools(ModelChanges changes, ModelReading reading) { return new DesignAgentTools(changes, reading); }

    @Bean JdbcAgentToolJournal agentToolJournal(JdbcTemplate db, ObjectMapper json) { return new JdbcAgentToolJournal(db, json); }

    @Bean RunDesignAgent runDesignAgent(ProjectFileCatalog projects, DesignAgentTools tools, AgentModelPort model, AgentToolJournal journal,
                                        AiRunJournal aiRuns, AiBudget budget, Transactions tx, ModelCatalog models,
                                        @Value("${agent.model:}") String modelId,
                                        com.obracota.domain.modelversion.port.VersionRepository versions,
                                        @Value("${agent.max-model-bytes:33554432}") long maxBytes) {
        return new RunDesignAgent(projects, tools, model, journal, aiRuns, budget, tx,
            modelId.isBlank() ? models.forCapability("CHAT").id() : modelId, versions::find, maxBytes);
    }
}
