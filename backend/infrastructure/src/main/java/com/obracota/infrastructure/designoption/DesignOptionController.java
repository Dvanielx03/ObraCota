package com.obracota.infrastructure.designoption;

import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.designoption.port.DesignOptionBatches;
import com.obracota.application.designoption.usecase.DesignOptions;
import com.obracota.application.designoption.usecase.Panoramas;
import com.obracota.infrastructure.assistant.adapters.out.ai.GeminiModels;
import com.obracota.infrastructure.common.exception.ErrorResponse;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import javax.imageio.ImageIO;
import java.io.*;

/** Visual options of an element. Input checks live here; the budget and the batches, in {@link DesignOptions}. */
@RestController @RequestMapping("/api/projects/{project}/versions/{version}/options")
public class DesignOptionController {
    private final DesignOptions options;
    private final GeminiModels gemini;
    private final Panoramas panoramas;
    /** Who receives the capture and the mask: the image provider in use, named for the privacy note before sending. */
    private final String images;
    public DesignOptionController(DesignOptions options,GeminiModels gemini,Panoramas panoramas,
            @org.springframework.beans.factory.annotation.Value("${IMAGE_PROVIDER:gemini}") String imageProvider) {
        this.options=options;this.gemini=gemini;this.panoramas=panoramas;
        this.images="cloudflare".equals(imageProvider)?"Cloudflare":"Gemini";
    }
    public record PanoramaInput(String scene,String jpeg) {}
    public record Input(UUID id,String element,String name,String request,String jpeg,String mask) {}
    private boolean valid(String value,int max) {return value!=null && !value.isBlank() && value.length()<=max;}
    private byte[] screenshot(String encoded) {
        if(!valid(encoded,1_500_000)) throw new IllegalArgumentException();
        byte[] bytes=Base64.getDecoder().decode(encoded);
        try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers=ImageIO.getImageReaders(stream);
            if(!readers.hasNext()) throw new IllegalArgumentException();
            var reader=readers.next();
            try {
                reader.setInput(stream);
                if(!reader.getFormatName().equalsIgnoreCase("JPEG") || reader.getWidth(0)>1280 || reader.getHeight(0)>1280)
                    throw new IllegalArgumentException();
                reader.read(0);
            } finally {reader.dispose();}
        } catch(IOException e) {throw new IllegalArgumentException();}
        return bytes;
    }
    @GetMapping
    public Map<String,Object> list(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestParam String element) {
        var listing=options.list(project,version,user,element);
        // The client shows the cost before sending; the limit is still enforced on submit.
        return Map.of("available",gemini.configured(),"images",images,"batches",listing.batches(),
            "budget",Map.of("reserve_cents",options.reserveCents(),"remaining_cents",listing.remainingCents()));
    }
    @PostMapping @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,UUID> submit(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestBody Input input) {
        if(input.id()==null || !valid(input.element(),512) || !valid(input.name(),512) || !valid(input.request(),2000)) throw new IllegalArgumentException();
        if(!gemini.configured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Falta configurar Gemini en el servidor.");
        byte[] bytes=screenshot(input.jpeg());
        byte[] mask=input.mask()==null?null:screenshot(input.mask());
        try {
            var id=options.submit(project,user,new DesignOptionBatches.NewBatch(input.id(),version,user,input.element(),input.name(),input.request(),bytes,mask));
            return Map.of("id",id);
        } catch(AiBudget.Exhausted e) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Se alcanzó el presupuesto mensual de opciones.");
        }
    }
    /**
     * «Panorama 360° con IA»: a 2:1 equirectangular picture of the scene, returned at once and not stored. The current
     * view (JPEG, optional) guides the look of the building.
     */
    @PostMapping("/panorama")
    public ResponseEntity<byte[]> panorama(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@RequestBody PanoramaInput input) {
        if(!valid(input.scene(),Panoramas.SCENE_LIMIT)) throw new IllegalArgumentException();
        byte[] reference=input.jpeg()==null || input.jpeg().isBlank()?null:screenshot(input.jpeg());
        try {
            var image=panoramas.generate(project,version,user,input.scene(),reference);
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(image.mime())).body(image.bytes());
        } catch(Panoramas.Unavailable e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"El panorama 360° necesita el proveedor de imágenes gratuito (Cloudflare) en el servidor.");
        } catch(AiBudget.Exhausted e) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Se alcanzó el presupuesto mensual de IA.");
        } catch(IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"HTTP_429".equals(e.getMessage())
                ?"El proveedor de imágenes alcanzó su límite diario. Prueba más tarde.":"No se pudo generar el panorama. Prueba de nuevo.");
        }
    }
    @GetMapping("/{id}/images/{slot}")
    public ResponseEntity<byte[]> image(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id,@PathVariable int slot) {
        var image=options.image(project,version,user,id,slot);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(image.mime())).body(image.bytes());
    }
    @GetMapping("/{id}/mask")
    public ResponseEntity<byte[]> mask(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id) {
        var mask=options.mask(project,version,user,id);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_JPEG).body(mask.bytes());
    }
    @PutMapping("/{id}/selection/{slot}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void select(@PathVariable UUID project,@PathVariable UUID version,@AuthenticationPrincipal UUID user,@PathVariable UUID id,@PathVariable int slot) {
        options.select(project,version,user,id,slot);
    }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ErrorResponse> problem(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(new ErrorResponse(e.getReason()));
    }
}
