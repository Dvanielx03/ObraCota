package com.obracota.domain.assistant.port.service;
import com.obracota.domain.airun.Consumption;
public interface ImageGenerationPort {
    record Image(byte[] bytes, String mime, Consumption usage) {}
    Image edit(String model, byte[] jpeg, String prompt);
    default Image edit(String model,byte[] jpeg,byte[] mask,String prompt){
        if(mask!=null)throw new UnsupportedOperationException("Selection mask not supported");
        return edit(model,jpeg,prompt);
    }
}
