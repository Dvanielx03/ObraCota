package com.obracota.domain.security.port.service;

public interface PasswordService {
    String hash(String password);
    boolean matches(String password, String hash);
}
