package com.obracota.infrastructure.assistant.adapters.out.ai;

import com.fasterxml.jackson.databind.*;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.*;
import com.obracota.application.designoption.GenerateOptions.ProviderFailure;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

@Component
public class GeminiModels implements ChatModelPort, ImageGenerationPort, com.obracota.domain.knowledge.port.service.EmbeddingPort {
    private final ObjectMapper json;
    private final String key;
    private final URI endpoint;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    @org.springframework.beans.factory.annotation.Autowired
    public GeminiModels(ObjectMapper json,@Value("${GEMINI_API_KEY:}") String key) {
        this(json,key,URI.create("https://generativelanguage.googleapis.com/v1beta/models/"));
    }
    GeminiModels(ObjectMapper json,String key,URI endpoint) {this.json=json;this.key=key;this.endpoint=endpoint;}
    public boolean configured() {return !key.isBlank();}
    private JsonNode generate(String model,List<?> parts,Map<String,Object> config) {
        return call(model, "generateContent", Map.of("contents",List.of(Map.of("role","user","parts",parts)), "generationConfig",config));
    }
    private JsonNode call(String model,String method,Object body) {
        try {
            var request=HttpRequest.newBuilder(URI.create(endpoint.toString()+model+":"+method))
                .timeout(Duration.ofSeconds(110)).header("x-goog-api-key",key).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body))).build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofByteArray());
            if(response.statusCode()!=200) throw new ProviderFailure("HTTP_"+response.statusCode());
            return json.readTree(response.body());
        } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new ProviderFailure("INTERRUPTED");}
        catch(java.io.IOException e) {throw new ProviderFailure("NETWORK_ERROR");}
    }
    public List<float[]> embed(String model,List<String> texts) {
        var requests=texts.stream().map(text->Map.of("model","models/"+model,"outputDimensionality",768,
            "content",Map.of("parts",List.of(Map.of("text",text))))).toList();
        var response=call(model,"batchEmbedContents",Map.of("requests",requests));
        List<float[]> vectors=new ArrayList<>();
        for(var entry:response.path("embeddings")){
            var values=entry.path("values");
            if(values.size()!=768)throw new ProviderFailure("INVALID_EMBEDDING");
            float[] vector=new float[768];
            for(int i=0;i<vector.length;i++)vector[i]=(float)values.get(i).asDouble();
            vectors.add(vector);
        }
        if(vectors.size()!=texts.size())throw new ProviderFailure("INVALID_EMBEDDING");
        return vectors;
    }
    private Integer count(JsonNode usage,String key) {return usage.path(key).isNumber()?usage.get(key).intValue():null;}
    private Consumption usage(JsonNode response) {
        var u=response.path("usageMetadata");
        return new Consumption(count(u,"promptTokenCount"),count(u,"candidatesTokenCount"),count(u,"totalTokenCount"));
    }
    public Reply complete(String model,String prompt) {
        var result=generate(model,List.of(Map.of("text",prompt)),Map.of("maxOutputTokens",1024));
        StringBuilder text=new StringBuilder();
        for(var part:result.at("/candidates/0/content/parts")) if(!part.path("thought").asBoolean()) text.append(part.path("text").asText(""));
        return new Reply(text.toString(),usage(result));
    }
    public Image edit(String model,byte[] jpeg,String prompt) {
        return edit(model,jpeg,null,prompt);
    }
    public Image edit(String model,byte[] jpeg,byte[] mask,String prompt) {
        var data=Map.of("mimeType","image/jpeg","data",Base64.getEncoder().encodeToString(jpeg));
        List<Object> parts=new ArrayList<>();
        parts.add(Map.of("inlineData",data));
        if(mask!=null)parts.add(Map.of("inlineData",Map.of("mimeType","image/jpeg","data",Base64.getEncoder().encodeToString(mask))));
        parts.add(Map.of("text",prompt));
        var result=generate(model,parts,
            Map.of("responseModalities",List.of("IMAGE"),"imageConfig",Map.of("imageSize","1K"),"maxOutputTokens",4096));
        for(var part:result.at("/candidates/0/content/parts")) {
            if(part.path("thought").asBoolean()) continue;
            var inline=part.path("inlineData");
            String mime=inline.path("mimeType").asText();
            if(Set.of("image/png","image/jpeg","image/webp").contains(mime) && !inline.path("data").asText().isEmpty())
                if(mask==null)return new Image(Base64.getDecoder().decode(inline.get("data").asText()),mime,usage(result));
                else return composite(jpeg,mask,Base64.getDecoder().decode(inline.get("data").asText()),usage(result));
        }
        throw new ProviderFailure("NO_IMAGE",usage(result));
    }
    Image composite(byte[] reference,byte[] mask,byte[] edit,Consumption usage){
        try{
            var base=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(reference));
            var coverage=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(mask));
            var change=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(edit));
            int w=base.getWidth(),h=base.getHeight();
            if(change==null || coverage==null || coverage.getWidth()!=w || coverage.getHeight()!=h ||
                Math.abs((double)change.getWidth()*h/(change.getHeight()*w)-1)>.03)
                throw new ProviderFailure("INCOMPATIBLE_IMAGE",usage);
            for(int y=0;y<h;y++)for(int x=0;x<w;x++){
                if((coverage.getRGB(x,y)&255)>=128)base.setRGB(x,y,change.getRGB(x*change.getWidth()/w,y*change.getHeight()/h));
            }
            var bytes=new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(base,"png",bytes);
            return new Image(bytes.toByteArray(),"image/png",usage);
        }catch(java.io.IOException ex){throw new ProviderFailure("INCOMPATIBLE_IMAGE",usage);}
    }
}
