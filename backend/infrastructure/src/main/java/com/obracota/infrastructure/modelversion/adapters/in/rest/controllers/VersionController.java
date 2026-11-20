package com.obracota.infrastructure.modelversion.adapters.in.rest.controllers;

import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelversion.model.*;
import com.obracota.infrastructure.common.exception.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController @RequestMapping("/api/projects/{project}") @Transactional(readOnly=true)
public class VersionController {
    private final ProjectVersions versions;
    public VersionController(ProjectVersions versions) { this.versions=versions; }
    @GetMapping("/files/{file}/versions")
    public List<ModelVersion> history(@PathVariable UUID project,@PathVariable UUID file,@AuthenticationPrincipal UUID user) {
        return versions.list(project,user,file);
    }
    @PostMapping(value="/uploads",consumes=MediaType.APPLICATION_OCTET_STREAM_VALUE)
    @ResponseStatus(HttpStatus.CREATED) @Transactional(rollbackFor=IOException.class)
    public ModelVersion upload(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestParam String name,
            @RequestParam(required=false) UUID file,HttpServletRequest request) throws IOException {
        return versions.upload(project,user,file,name,request.getContentLengthLong(),request.getInputStream());
    }
    @GetMapping("/versions/{id}")
    public ModelVersion get(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user) {
        return versions.get(project,user,id);
    }
    @GetMapping("/versions/{id}/original")
    public ResponseEntity<InputStreamResource> original(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user) throws IOException {
        var v=versions.get(project,user,id);
        var stream=versions.storage().read(project,id);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentLength(v.byteSize())
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(v.name(),StandardCharsets.UTF_8).build().toString())
            .body(new InputStreamResource(stream));
    }
    public record Note(String key,String text,boolean onlyIfAbsent) {}
    @GetMapping("/versions/{id}/notes")
    public Map<String,String> notes(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user) {
        return versions.notes(project,user,id);
    }
    @PutMapping("/versions/{id}/notes") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional
    public void note(@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal UUID user,@RequestBody Note note) {
        versions.note(project,user,id,note.key(),note.text(),note.onlyIfAbsent());
    }
    @ExceptionHandler(FileTooLargeException.class) @ResponseStatus(HttpStatus.PAYLOAD_TOO_LARGE)
    public ErrorResponse tooLarge() { return new ErrorResponse("El archivo supera los 256 MiB."); }
}
