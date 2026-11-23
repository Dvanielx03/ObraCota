package com.obracota.domain.assistant.port.service;
import com.obracota.domain.airun.Consumption;
public interface ImageGenerationPort {
    record Image(byte[] bytes, String mime, Consumption usage) {}
    Image edit(String model, byte[] jpeg, String prompt);
    default Image edit(String model,byte[] jpeg,byte[] mask,String prompt){
        if(mask!=null)throw new UnsupportedOperationException("Selection mask not supported");
        return edit(model,jpeg,prompt);
    }
    /** True when this provider can draw a picture of a chosen size, such as a 2:1 equirectangular panorama. */
    default boolean panoramas(){return false;}
    /**
     * A new picture of {@code width} × {@code height} from {@code prompt}; {@code reference} (JPEG, may be null) guides
     * its look. Providers without {@link #panoramas()} do not implement it.
     */
    default Image panorama(String model,byte[] reference,String prompt,int width,int height){
        throw new UnsupportedOperationException("Panorama not supported");
    }
}
