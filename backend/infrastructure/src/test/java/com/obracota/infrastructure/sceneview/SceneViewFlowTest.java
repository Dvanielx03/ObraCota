package com.obracota.infrastructure.sceneview;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.file.Path;
import java.util.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
class SceneViewFlowTest {
    @TempDir static Path volume;
    @DynamicPropertySource static void storage(DynamicPropertyRegistry config) {
        config.add("models.directory", () -> volume.toString());
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    String token() throws Exception {
        var response = mvc.perform(post("/api/auth/register").header("X-ObraCota-Client","web")
            .contentType("application/json").content(json.writeValueAsBytes(Map.of("email",UUID.randomUUID()+"@example.test","password","UnaClaveDePrueba!"))))
            .andExpect(status().isCreated()).andReturn().getResponse();
        return "Bearer "+json.readTree(response.getContentAsString()).get("accessToken").asText();
    }
    byte[] view(String name) throws Exception {
        return json.writeValueAsBytes(Map.of("name",name,"position",List.of(4.5,3.0,-2.0),"target",List.of(0.0,1.0,0.0),"span",1.75));
    }
    @Test void savesRenamesAndDeletesViewsOnlyForTheOwner() throws Exception {
        String owner=token(),other=token();
        var p=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json")
            .content("{\"name\":\"Obra con vistas\"}")).andExpect(status().isCreated()).andReturn();
        String base="/api/projects/"+json.readTree(p.getResponse().getContentAsString()).get("id").asText();
        var upload=mvc.perform(post(base+"/uploads").queryParam("name","planta.ifc").header("Authorization",owner)
            .contentType("application/octet-stream").content("ISO-10303-21;\nvistas")).andExpect(status().isCreated()).andReturn();
        String views=base+"/versions/"+json.readTree(upload.getResponse().getContentAsString()).get("id").asText()+"/views";

        mvc.perform(get(views).header("Authorization",owner)).andExpect(content().json("[]"));
        var saved=mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(view("  Acceso norte  ")))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("Acceso norte"))
            .andExpect(jsonPath("$.position[0]").value(4.5)).andExpect(jsonPath("$.target[1]").value(1.0))
            .andExpect(jsonPath("$.span").value(1.75)).andReturn();
        String one=views+"/"+json.readTree(saved.getResponse().getContentAsString()).get("id").asText();

        // Datos inválidos: sin nombre, nombre largo, vector incompleto y zoom no positivo.
        for (var bad:List.of(Map.of("name"," ","position",List.of(1,1,1),"target",List.of(0,0,0),"span",1),
                Map.of("name","x".repeat(61),"position",List.of(1,1,1),"target",List.of(0,0,0),"span",1),
                Map.of("name","Corta","position",List.of(1,1),"target",List.of(0,0,0),"span",1),
                Map.of("name","Sin altura","position",List.of(1,1,1),"target",List.of(0,0,0),"span",0),
                Map.of("name","Sin dirección","position",List.of(1,1,1),"target",List.of(1,1,1),"span",1)))
            mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(json.writeValueAsBytes(bad)))
                .andExpect(status().isBadRequest());

        // Otra cuenta no ve ni toca nada.
        mvc.perform(get(views).header("Authorization",other)).andExpect(status().isNotFound());
        mvc.perform(post(views).header("Authorization",other).contentType("application/json").content(view("Ajena"))).andExpect(status().isNotFound());
        mvc.perform(put(one).header("Authorization",other).contentType("application/json").content("{\"name\":\"Ajena\"}")).andExpect(status().isNotFound());
        mvc.perform(delete(one).header("Authorization",other)).andExpect(status().isNotFound());

        mvc.perform(put(one).header("Authorization",owner).contentType("application/json").content("{\"name\":\"Fachada\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Fachada"));
        mvc.perform(put(one).header("Authorization",owner).contentType("application/json").content("{\"name\":\"\"}")).andExpect(status().isBadRequest());
        mvc.perform(put(views+"/"+UUID.randomUUID()).header("Authorization",owner).contentType("application/json").content("{\"name\":\"Nada\"}"))
            .andExpect(status().isNotFound());
        mvc.perform(get(views).header("Authorization",owner)).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].name").value("Fachada"));

        // Tope por versión.
        for (int i=1;i<24;i++)
            mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(view("Vista "+i))).andExpect(status().isCreated());
        mvc.perform(post(views).header("Authorization",owner).contentType("application/json").content(view("De más"))).andExpect(status().isBadRequest());

        mvc.perform(delete(one).header("Authorization",owner)).andExpect(status().isNoContent());
        mvc.perform(delete(one).header("Authorization",owner)).andExpect(status().isNotFound());
        mvc.perform(get(views).header("Authorization",owner)).andExpect(jsonPath("$.length()").value(23));
    }

    /** A tiny byte sequence with the JPEG start marker; {@code mark} tells the images apart. */
    static byte[] jpeg(int mark) {
        return new byte[]{(byte)0xFF,(byte)0xD8,(byte)0xFF,(byte)0xE0,0,16,(byte)mark,(byte)0xFF,(byte)0xD9};
    }
    static String dataUrl(byte[] bytes) { return "data:image/jpeg;base64,"+Base64.getEncoder().encodeToString(bytes); }
    byte[] view(String name, String thumbnail) throws Exception {
        return json.writeValueAsBytes(Map.of("name",name,"position",List.of(4.5,3.0,-2.0),"target",List.of(0.0,1.0,0.0),"span",1.75,"thumbnail",thumbnail));
    }
    String upload(String base, String owner) throws Exception {
        var upload=mvc.perform(post(base+"/uploads").queryParam("name","planta.ifc").header("Authorization",owner)
            .contentType("application/octet-stream").content("ISO-10303-21;\nvistas "+UUID.randomUUID())).andExpect(status().isCreated()).andReturn();
        return base+"/versions/"+json.readTree(upload.getResponse().getContentAsString()).get("id").asText()+"/views";
    }
    String id(org.springframework.test.web.servlet.MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString()).get("id").asText();
    }

    @Test void storesThumbnailsAndPicksTheProjectCoverOnlyForTheOwner() throws Exception {
        String owner=token(),other=token();
        var p=mvc.perform(post("/api/projects").header("Authorization",owner).contentType("application/json")
            .content("{\"name\":\"Obra con portada\"}")).andExpect(status().isCreated()).andReturn();
        String base="/api/projects/"+id(p),cover=base+"/cover";
        String first=upload(base,owner);

        // Without any preview there is no cover yet.
        mvc.perform(get(cover).header("Authorization",owner)).andExpect(status().isNotFound());

        // A view without preview, then two with one: the list says which have it.
        String plain=first+"/"+id(mvc.perform(post(first).header("Authorization",owner).contentType("application/json").content(view("Sin imagen")))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.hasThumbnail").value(false)).andReturn());
        String north=first+"/"+id(mvc.perform(post(first).header("Authorization",owner).contentType("application/json").content(view("Norte",dataUrl(jpeg(1)))))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.hasThumbnail").value(true)).andReturn());
        mvc.perform(post(first).header("Authorization",owner).contentType("application/json").content(view("Sur",dataUrl(jpeg(2)))))
            .andExpect(status().isCreated());
        mvc.perform(get(first).header("Authorization",owner)).andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$[0].hasThumbnail").value(false)).andExpect(jsonPath("$[1].hasThumbnail").value(true))
            .andExpect(jsonPath("$[2].hasThumbnail").value(true));

        // The preview comes back as a JPEG; missing previews, unknown views and other accounts get 404.
        mvc.perform(get(north+"/thumbnail").header("Authorization",owner)).andExpect(status().isOk())
            .andExpect(content().contentType("image/jpeg")).andExpect(content().bytes(jpeg(1)));
        mvc.perform(get(plain+"/thumbnail").header("Authorization",owner)).andExpect(status().isNotFound());
        mvc.perform(get(first+"/"+UUID.randomUUID()+"/thumbnail").header("Authorization",owner)).andExpect(status().isNotFound());
        mvc.perform(get(north+"/thumbnail").header("Authorization",other)).andExpect(status().isNotFound());

        // Only JPEG data URLs of at most 80 KB are accepted.
        byte[] large=Arrays.copyOf(jpeg(3),80*1024+1);
        byte[] notJpeg={(byte)0x89,'P','N','G',13,10,26,10};
        for (String bad:List.of("data:image/png;base64,"+Base64.getEncoder().encodeToString(jpeg(3)),
                "data:image/jpeg;base64,%%%no-base64%%%", dataUrl(large), dataUrl(notJpeg), dataUrl(new byte[0]), Base64.getEncoder().encodeToString(jpeg(3))))
            mvc.perform(post(first).header("Authorization",owner).contentType("application/json").content(view("Inválida",bad)))
                .andExpect(status().isBadRequest());
        mvc.perform(post(first).header("Authorization",owner).contentType("application/json").content(view("Al límite",dataUrl(Arrays.copyOf(jpeg(4),80*1024)))))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.hasThumbnail").value(true));

        // Cover: first view with a preview (by date) of the newest version that has one.
        mvc.perform(get(cover).header("Authorization",owner)).andExpect(status().isOk())
            .andExpect(content().contentType("image/jpeg")).andExpect(content().bytes(jpeg(1)));
        mvc.perform(get(cover).header("Authorization",other)).andExpect(status().isNotFound());
        mvc.perform(get("/api/projects/"+UUID.randomUUID()+"/cover").header("Authorization",owner)).andExpect(status().isNotFound());

        // A newer revision without previews does not change it; one with a preview takes over.
        String second=upload(base,owner);
        mvc.perform(post(second).header("Authorization",owner).contentType("application/json").content(view("Sin imagen"))).andExpect(status().isCreated());
        mvc.perform(get(cover).header("Authorization",owner)).andExpect(content().bytes(jpeg(1)));
        String latest=second+"/"+id(mvc.perform(post(second).header("Authorization",owner).contentType("application/json").content(view("Acceso",dataUrl(jpeg(5)))))
            .andExpect(status().isCreated()).andReturn());
        mvc.perform(get(cover).header("Authorization",owner)).andExpect(status().isOk()).andExpect(content().bytes(jpeg(5)));

        // Renaming keeps the preview; deleting it brings back the previous cover.
        mvc.perform(put(latest).header("Authorization",owner).contentType("application/json").content("{\"name\":\"Acceso principal\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.hasThumbnail").value(true));
        mvc.perform(delete(latest).header("Authorization",owner)).andExpect(status().isNoContent());
        mvc.perform(get(cover).header("Authorization",owner)).andExpect(content().bytes(jpeg(1)));
        mvc.perform(delete(north).header("Authorization",owner)).andExpect(status().isNoContent());
        mvc.perform(get(cover).header("Authorization",owner)).andExpect(content().bytes(jpeg(2)));
    }
}
