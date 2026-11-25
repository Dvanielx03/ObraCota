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

/**
 * REST entry of the document assistant; retrieval, budget and citation checks live in {@link AskDocument}. A question
 * names one PDF ({@code document}) or one piece of a version ({@code version} and {@code element}).
 */
@RestController
@RequestMapping("/api/projects/{project}/assistant")
public class DocumentAssistant {
    private final AskDocument assistant;
    public DocumentAssistant(AskDocument assistant) { this.assistant=assistant; }
    public record Question(UUID document,UUID version,String element,String question){}
    @GetMapping
    public List<Source> sources(@PathVariable UUID project,@AuthenticationPrincipal UUID user){
        return assistant.sources(project,user);
    }
    @GetMapping("/history")
    public List<Map<String,Object>> history(@PathVariable UUID project,@AuthenticationPrincipal UUID user,
        @RequestParam(required=false) UUID document,@RequestParam(required=false) UUID version,@RequestParam(required=false) String element){
        if(document!=null)return assistant.history(project,user,document);
        return assistant.history(project,user,version,element);
    }
    @PostMapping
    public Answer ask(@PathVariable UUID project,@AuthenticationPrincipal UUID user,@RequestBody Question q) {
        try {
            if(q.document()!=null)return assistant.ask(project,user,q.document(),q.question());
            return assistant.askPiece(project,user,q.version(),q.element(),q.question());
        } catch(AiBudget.Exhausted e) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Presupuesto mensual agotado.");
        }
    }
}
