package com.obracota.domain.knowledge.port.service;
import java.util.List;

public interface EmbeddingPort {
    List<float[]> embed(String model,List<String> texts);
}
