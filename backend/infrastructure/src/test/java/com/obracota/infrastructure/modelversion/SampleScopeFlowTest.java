package com.obracota.infrastructure.modelversion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.modelversion.usecase.SampleScopes;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * {@code POST /api/projects/sample/restage}: one hidden project and version per person, the same on every call, reached
 * only by its owner, outside the project list, and usable as the scope of the options routes (Renderizar, Panorama).
 */
@SpringBootTest(properties={"ai.queue.initial-delay=600000","GEMINI_API_KEY=test-only"})
@AutoConfigureMockMvc @ActiveProfiles("test")
class SampleScopeFlowTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Autowired SampleScopes samples;

    String register() throws Exception { return register(UUID.randomUUID()+"@example.test"); }
    String register(String email) throws Exception {
        var result=mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web").contentType("application/json")
          .content(json.writeValueAsBytes(Map.of("email",email,"password","UnaClaveDePrueba!")))).andExpect(status().isCreated()).andReturn();
        return "Bearer "+json.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
    }
    JsonNode scope(String user) throws Exception {
        var result=mvc.perform(post("/api/projects/sample/restage").header("Authorization",user)).andExpect(status().isOk()).andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }

    @Test void isIdempotentPerPersonHiddenAndOwnerOnly() throws Exception {
        var owner=register();
        var first=scope(owner);
        var again=scope(owner);
        assertEquals(first.get("project").asText(),again.get("project").asText());
        assertEquals(first.get("version").asText(),again.get("version").asText());
        var project=UUID.fromString(first.get("project").asText());
        assertEquals(1,db.queryForObject("select count(*) from project where id=? and sample='restage'",Integer.class,project));
        assertEquals("GLB",db.queryForObject("select format from model_version where id=?",String.class,UUID.fromString(first.get("version").asText())));

        // The sample stays out of the person's list; projects the person creates are still there.
        mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json").content("{\"name\":\"Mío\"}")).andExpect(status().isCreated());
        mvc.perform(get("/api/projects").header("Authorization",owner)).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].name").value("Mío"));

        // The options routes take it as a scope: the history and the AI budget are read as for any version.
        var base="/api/projects/"+project+"/versions/"+first.get("version").asText()+"/options";
        mvc.perform(get(base).param("element","view").header("Authorization",owner)).andExpect(status().isOk())
          .andExpect(jsonPath("$.batches.length()").value(0)).andExpect(jsonPath("$.budget.remaining_cents").isNumber());

        // Another person gets a scope of their own and cannot reach the first one.
        var other=register();
        var theirs=scope(other);
        assertNotEquals(first.get("project").asText(),theirs.get("project").asText());
        mvc.perform(get(base).param("element","view").header("Authorization",other)).andExpect(status().isNotFound());

        // Without a session there is no scope, and an unknown sample is not found.
        mvc.perform(post("/api/projects/sample/restage")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/projects/sample/otro").header("Authorization",owner)).andExpect(status().isNotFound());
    }

    @Test void concurrentFirstRequestsShareOneScope() throws Exception {
        var email=UUID.randomUUID()+"@example.test";
        register(email);
        var user=db.queryForObject("select id from security_user where email=?",UUID.class,email);
        var pool=Executors.newFixedThreadPool(4);
        try {
            var start=new CountDownLatch(1);
            List<Future<SampleScopesResult>> calls=new ArrayList<>();
            for(int i=0;i<4;i++) calls.add(pool.submit(()->{start.await();var s=samples.ensure(user,"restage");return new SampleScopesResult(s.project(),s.version());}));
            start.countDown();
            var seen=new HashSet<SampleScopesResult>();
            for(var call:calls) seen.add(call.get(30,TimeUnit.SECONDS));
            assertEquals(1,seen.size());
            assertEquals(1,db.queryForObject("select count(*) from project where owner_id=? and sample='restage'",Integer.class,user));
        } finally { pool.shutdownNow(); }
    }
    record SampleScopesResult(UUID project,UUID version) {}
}
