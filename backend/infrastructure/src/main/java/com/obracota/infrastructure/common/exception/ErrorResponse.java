package com.obracota.infrastructure.common.exception;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Error body: {@code {"message": "...", "code": "..."}}. {@code code} is optional and left out when absent. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(String message, String code) {
    public ErrorResponse(String message) { this(message, null); }
}
