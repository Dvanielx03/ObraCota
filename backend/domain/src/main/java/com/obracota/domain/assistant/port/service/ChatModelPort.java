package com.obracota.domain.assistant.port.service;
import com.obracota.domain.airun.Consumption;
public interface ChatModelPort {
    record Reply(String text, Consumption usage) {}
    Reply complete(String model, String prompt);
}
