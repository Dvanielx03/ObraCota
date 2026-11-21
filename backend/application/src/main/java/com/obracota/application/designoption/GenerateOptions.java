package com.obracota.application.designoption;
import com.obracota.domain.assistant.port.service.*;
import com.obracota.domain.airun.Consumption;
import java.util.UUID;
import java.util.List;

public record GenerateOptions(ChatModelPort chat, ImageGenerationPort images, Journal journal, String chatModel, String imageModel) {
    public interface Journal {
        UUID start(UUID batch,int slot,String model);
        void finish(UUID run,Consumption usage);
        void fail(UUID run,String error,Consumption usage);
        void save(UUID batch,int slot,String description,ImageGenerationPort.Image image);
        void end(UUID batch,boolean success);
        void describe(UUID batch,List<String> variants);
    }
    public void execute(UUID batch,String element,String request,byte[] screenshot) {
        execute(batch,element,request,screenshot,null);
    }
    public void execute(UUID batch,String element,String request,byte[] screenshot,byte[] mask) {
        UUID run=null;
        try {
            run=journal.start(batch,0,chatModel);
            var reply=chat.complete(chatModel,"Write exactly three distinct, short visual design alternatives in Spanish, one per line, for the selected BIM element. Respect the user request. No prices, measurements, or approval claims. Element: "+element+"\nRequest: "+request);
            journal.finish(run,reply.usage());
            run=null;
            List<String> variants=reply.text().lines().map(String::strip).filter(s->!s.isEmpty()).toList();
            if(variants.size()!=3 || variants.stream().distinct().count()!=3 || variants.stream().anyMatch(s->s.length()>500))
                throw new IllegalArgumentException("Invalid alternatives");
            journal.describe(batch,variants);
            for(int index=0; index<3; index++) {
                int slot=index+1;
                run=journal.start(batch,slot,imageModel);
                String target=mask==null?"Edit the orange selection and remove its highlight.":"The second image is an aligned mask. Edit only the white regions in the FIRST image. Black regions including terrain stay unchanged.";
                var image=images.edit(imageModel,screenshot,mask,"Edit this exact BIM screenshot. Preserve camera, crop, projection and other elements. "+target+" Do not add text or dimensions. Selection: "+element+"\nRequest: "+request+"\nOption: "+variants.get(index));
                journal.finish(run,image.usage());
                run=null;
                journal.save(batch,slot,variants.get(index),image);
            }
            journal.end(batch,true);
        } catch(RuntimeException e) {
            if(run!=null) journal.fail(run,e instanceof ProviderFailure failure ? failure.code() : "PROVIDER_OR_STORAGE_ERROR",
                e instanceof ProviderFailure f ? f.usage : new Consumption(null,null,null));
            journal.end(batch,false);
        }
    }
    public static class ProviderFailure extends RuntimeException {
        final Consumption usage;
        public ProviderFailure(String code) {this(code,new Consumption(null,null,null));}
        public ProviderFailure(String code,Consumption usage) {super(code);this.usage=usage;}
        public String code() {return getMessage();}
    }
}
