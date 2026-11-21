package com.obracota.application.knowledge;

import java.util.*;
import java.util.regex.Pattern;
import java.text.Normalizer;

public final class SpecificationSearch {
    public record Page(UUID document,String filename,int page,String content) {}
    public record Citation(UUID document,String filename,int page,String excerpt,int matches) {}
    private static final Pattern FINISH=Pattern.compile("\\b(acabados?|finish(es)?|textures?|textured|lisa|liso|smooth|paint(ed)?|pintura|barniz|lacado)\\b");
    private static String normalize(String text) {
        return Normalizer.normalize(text.toLowerCase(Locale.ROOT),Normalizer.Form.NFD).replaceAll("\\p{M}","");
    }
    public static List<Citation> find(List<Page> pages,String query) {
        var words = normalize(query).strip();
        if(words.isEmpty())return List.of();
        var pattern=words.equals("acabado")?FINISH:Pattern.compile(Pattern.quote(words));
        List<Citation> hits=new ArrayList<>();
        for(var page:pages){
            String normalized=normalize(page.content());
            var matcher=pattern.matcher(normalized);
            if(!matcher.find())continue;
            int start=Math.max(0,matcher.start()-48),end=Math.min(page.content().length(),matcher.end()+100),count=1;
            while(matcher.find())count++;
            hits.add(new Citation(page.document(),page.filename(),page.page(),page.content().substring(Math.min(start,end),end),count));
        }
        return hits.stream().sorted(Comparator.comparingInt(Citation::matches).reversed().thenComparing(Citation::filename).thenComparingInt(Citation::page)).limit(8).toList();
    }
}
