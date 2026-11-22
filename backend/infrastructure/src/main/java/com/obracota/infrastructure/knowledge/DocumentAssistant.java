package com.obracota.infrastructure.knowledge;

import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.knowledge.port.SpecificationPassages.Answer;
import com.obracota.application.knowledge.port.SpecificationPassages.Source;
import com.obracota.application.knowledge.usecase.AskDocument;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

/** REST entry of the document assistant; retrieval, budget and citation checks live in {@link AskDocument}. */
@RestController
@RequestMapping("/api/projects/{project}/assistant")
public class DocumentAssistant {
    private final AskDocument assistant;
    public DocumentAssistant(AskDocument assistant) { this.assistant=assistant; }
    public record Question(UUID document,String question){}
    @GetMapping
    public List<Source> sources(@PathVariable UUID project,@AuthenticationPrincipal UUID user){
        return assistant.sources(project,user);
    }
    @GetMapping("/history")
    public List<Map<String,Object>> history(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestParam UUID document){
        return assistant.history(project,user,document);
    }
    @PostMapping
    public Answer ask(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestBody Question q) {
        try {
            return assistant.ask(project,user,q.document(),q.question());
        } catch(AiBudget.Exhausted e) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Presupuesto mensual agotado.");
        }
    }
}
