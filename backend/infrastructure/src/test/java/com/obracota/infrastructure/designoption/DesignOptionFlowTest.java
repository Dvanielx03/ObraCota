package com.obracota.infrastructure.designoption;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.domain.assistant.port.service.*;
import com.obracota.domain.airun.Consumption;
import com.obracota.application.designoption.GenerateOptions.ProviderFailure;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.*;
import org.springframework.context.annotation.*;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import java.io.ByteArrayOutputStream;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.nio.file.Path;
import java.util.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"ai.queue.initial-delay=600000","GEMINI_API_KEY=test-only","AI_MONTHLY_LIMIT_CENTS=300"})
@AutoConfigureMockMvc @ActiveProfiles("test") @Import(DesignOptionFlowTest.Trial.class)
class DesignOptionFlowTest {
    @TempDir static Path root;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r){r.add("models.directory",()->root.toString());}
    static byte[] picture(int color,String format) {
        var image=new BufferedImage(8,8,BufferedImage.TYPE_INT_RGB);image.setRGB(4,4,color);
        try(var out=new ByteArrayOutputStream()){ImageIO.write(image,format,out);return out.toByteArray();}
        catch(Exception e){throw new AssertionError(e);}
    }
    @TestConfiguration static class Trial {
        @Bean @Primary ChatModelPort trialChat(){return (model,prompt)->{
            if(prompt.contains("techo uniforme"))throw new ProviderFailure("HTTP_503");
            return new ChatModelPort.Reply("Roble\nAcero\nPino",new Consumption(8,3,11));
        };}
        @Bean @Primary ImageGenerationPort trialImage(){return (model,jpeg,prompt)->{
            if(prompt.contains("fallar"))throw new ProviderFailure("HTTP_429");
            return new ImageGenerationPort.Image(picture(prompt.hashCode(),"png"),"image/png",new Consumption(10,20,30));
        };}
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired OptionJobs worker;
    @Autowired JdbcTemplate db;
    String register() throws Exception {
        var result=mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web").contentType("application/json")
          .content(json.writeValueAsBytes(Map.of("email",UUID.randomUUID()+"@example.test","password","UnaClaveDePrueba!")))).andExpect(status().isCreated()).andReturn();
        return "Bearer "+json.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
    }
    @Test void recordsEachCallAndPersistsOnlyAnExplicitSelection() throws Exception {
        var user=register();
        var result=mvc.perform(post("/api/projects").header("Authorization",user).contentType("application/json")
          .content("{\"name\":\"Prueba visual\"}")).andExpect(status().isCreated()).andReturn();
        var project=json.readTree(result.getResponse().getContentAsString()).get("id").asText();
        var upload=mvc.perform(post("/api/projects/"+project+"/uploads").queryParam("name","p.ifc").header("Authorization",user)
          .contentType("application/octet-stream").content("ISO-10303-21;")).andExpect(status().isCreated()).andReturn();
        var version=json.readTree(upload.getResponse().getContentAsString()).get("id").asText();
        var base="/api/projects/"+project+"/versions/"+version+"/options";
        var capture=picture(0xff00,"jpeg");
        var id=UUID.randomUUID();
        var input=new DesignOptionController.Input(id,"guid-1","Puerta","Cambiar acabado",Base64.getEncoder().encodeToString(capture),null);
        for(int i=0;i<2;i++) mvc.perform(post(base).header("Authorization",user).contentType("application/json").content(json.writeValueAsBytes(input))).andExpect(status().isAccepted());
        mvc.perform(put(base+"/"+id+"/selection/1").header("Authorization",user)).andExpect(status().isConflict());
        worker.process();
        mvc.perform(get(base).param("element","guid-1").header("Authorization",user)).andExpect(jsonPath("$.batches[0].state").value("READY"))
          .andExpect(jsonPath("$.batches[0].runs.length()").value(4)).andExpect(jsonPath("$.batches[0].options.length()").value(3))
          .andExpect(jsonPath("$.budget.reserve_cents").value(100)).andExpect(jsonPath("$.budget.remaining_cents").isNumber());
        for(int slot=1;slot<=3;slot++)
            mvc.perform(get(base+"/"+id+"/images/"+slot).header("Authorization",user)).andExpect(content().contentType("image/png"));
        mvc.perform(get(base+"/"+id+"/images/0").header("Authorization",user)).andExpect(content().bytes(capture));
        mvc.perform(get(base+"/"+id+"/mask").header("Authorization",user)).andExpect(status().isNotFound());
        mvc.perform(put(base+"/"+id+"/selection/2").header("Authorization",user)).andExpect(status().isNoContent());
        mvc.perform(get(base).param("element","guid-1").header("Authorization",user)).andExpect(jsonPath("$.batches[0].selected").value(2));
        mvc.perform(get(base+"/"+id+"/images/1").header("Authorization",register())).andExpect(status().isNotFound());
        assertEquals(101,db.queryForObject("select sum(total_tokens) from ai_run where batch_id=?",Integer.class,id));
        var failed=UUID.randomUUID();
        var bad=new DesignOptionController.Input(failed,"guid-1","Puerta","fallar",input.jpeg(),null);
        mvc.perform(post(base).header("Authorization",user).contentType("application/json").content(json.writeValueAsBytes(bad))).andExpect(status().isAccepted());
        worker.process();
        assertEquals("HTTP_429",db.queryForObject("select error_code from ai_run where batch_id=? and slot=1",String.class,failed));
        assertEquals("FAILED",db.queryForObject("select state from design_option_batch where id=?",String.class,failed));
        var failedChat=UUID.randomUUID();
        var mask=picture(0xffffff,"jpeg");
        var roof=new DesignOptionController.Input(failedChat,"roof","Cubierta","Quiero un techo uniforme",input.jpeg(),Base64.getEncoder().encodeToString(mask));
        mvc.perform(post(base).header("Authorization",user).contentType("application/json").content(json.writeValueAsBytes(roof))).andExpect(status().isAccepted());
        worker.process();
        mvc.perform(get(base).param("element","roof").header("Authorization",user)).andExpect(status().isOk())
            .andExpect(jsonPath("$.batches[0].state").value("FAILED"))
            .andExpect(jsonPath("$.batches[0].hasMask").value(true))
            .andExpect(jsonPath("$.batches[0].runs[0].slot").value(0))
            .andExpect(jsonPath("$.batches[0].runs[0].error_code").value("HTTP_503"))
            .andExpect(jsonPath("$.batches[0].options.length()").value(0));
        mvc.perform(get(base+"/"+failedChat+"/mask").header("Authorization",user)).andExpect(status().isOk()).andExpect(content().bytes(mask));
        mvc.perform(get(base+"/"+failedChat+"/mask").header("Authorization",register())).andExpect(status().isNotFound());
        var excess=new DesignOptionController.Input(UUID.randomUUID(),"guid-1","Puerta","Otro",input.jpeg(),null);
        mvc.perform(post(base).header("Authorization",user).contentType("application/json").content(json.writeValueAsBytes(excess))).andExpect(status().isTooManyRequests());
    }
}
