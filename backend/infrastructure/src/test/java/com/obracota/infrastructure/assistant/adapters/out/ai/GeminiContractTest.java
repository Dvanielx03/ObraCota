package com.obracota.infrastructure.assistant.adapters.out.ai;

import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class GeminiContractTest {
    private byte[] pixels(int first,int second) throws Exception {
        var image=new java.awt.image.BufferedImage(2,1,java.awt.image.BufferedImage.TYPE_INT_RGB);
        image.setRGB(0,0,first);image.setRGB(1,0,second);
        var out=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",out);return out.toByteArray();
    }
    @Test void keepsTerrainPixelOutsideTheSelectedRegion() throws Exception{
        var adapter=new GeminiModels(new ObjectMapper(),"trial",URI.create("http://localhost/"));
        var result=adapter.composite(pixels(0x445522,0x999999),pixels(0,0xffffff),pixels(0xffffff,0x993322),null);
        var image=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(result.bytes()));
        assertEquals(0x445522,image.getRGB(0,0)&0xffffff);
        assertEquals(0x993322,image.getRGB(1,0)&0xffffff);
    }
    @Test void sendsReferenceAndReadsOnlyTheFinalImageAndProviderUsage() throws Exception {
        var json=new ObjectMapper();
        var seen=new AtomicReference<JsonNode>();
        var header=new AtomicReference<String>();
        byte[] reference={1,2},result={3,4};
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/model:generateContent",exchange->{
            header.set(exchange.getRequestHeaders().getFirst("x-goog-api-key"));
            seen.set(json.readTree(exchange.getRequestBody()));
            var data=Map.of("data",Base64.getEncoder().encodeToString(result),"mimeType","image/png");
            var parts=List.of(Map.of("thought",true,"text","private"),Map.of("inlineData",data));
            var body=json.writeValueAsBytes(Map.of("candidates",List.of(Map.of("content",Map.of("parts",parts))),
                "usageMetadata",Map.of("promptTokenCount",50,"candidatesTokenCount",60,"totalTokenCount",115)));
            exchange.sendResponseHeaders(200,body.length);
            try(var out=exchange.getResponseBody()){out.write(body);}
        });
        server.start();
        try {
            var adapter=new GeminiModels(json,"trial",URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/"));
            var reply=adapter.edit("model",reference,"Keep camera");
            assertArrayEquals(result,reply.bytes());assertEquals(115,reply.usage().totalTokens());
            assertEquals("trial",header.get());
            assertEquals("1K",seen.get().at("/generationConfig/imageConfig/imageSize").asText());
            assertArrayEquals(reference,seen.get().at("/contents/0/parts/0/inlineData/data").binaryValue());
        } finally {server.stop(0);}
    }
}
