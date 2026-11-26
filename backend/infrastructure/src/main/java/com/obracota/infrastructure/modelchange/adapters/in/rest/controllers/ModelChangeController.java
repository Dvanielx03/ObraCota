package com.obracota.infrastructure.modelchange.adapters.in.rest.controllers;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.InvalidRequestApplicationException;
import com.obracota.application.modelchange.usecase.ChangeView;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.domain.modelchange.model.ChangeStatus;
import com.obracota.domain.security.model.Actor;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import com.obracota.infrastructure.modelchange.adapters.out.json.ReportJson;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

/**
 * Model changes of a project (§4.3): drafting, preview, submit, discard, and publishing through {@link PublishModelChange}.
 * Every method receives the {@link Actor} resolved by {@code ActorArgumentResolver}; the use cases own the transactions
 * and the engine is never waited for inside one, so nothing here is {@code @Transactional}. Every answer, errors
 * included, carries {@code Cache-Control: no-store}.
 */
@RestController
@RequestMapping("/api/projects/{project}/model-changes")
public class ModelChangeController {
    private final ModelChanges changes;
    private final PublishModelChange publish;
    private final JacksonRecipeCodec recipes;
    private final ObjectMapper json;
    private final ReportJson reports = new ReportJson();

    public ModelChangeController(ModelChanges changes, PublishModelChange publish, JacksonRecipeCodec recipes, ObjectMapper json) {
        this.changes = changes;
        this.publish = publish;
        this.recipes = recipes;
        this.json = json;
    }

    public record Create(UUID baseVersion, String description) {}
    public record Submit(String summary) {}
    public record Discard(String reason) {}

    /** The {@code ModelChange} resource of §4.2. */
    public record Resource(UUID id, UUID project, UUID file, UUID baseVersion, int baseRevision, String baseName, String format,
                           ChangeStatus status, String origin, Person author, UUID agentRun, String description, String summary,
                           Map<String, Object> recipe, Map<String, Object> report, boolean reportCurrent, Preview preview,
                           boolean picture, JsonNode legacyReview, UUID appliedVersion, Instant appliedAt, Person appliedBy,
                           UUID restoredVersion, Instant restoredAt, Person restoredBy, Instant discardedAt, DiscardedBy discardedBy,
                           Instant createdAt, Instant updatedAt, Actions actions) {}
    public record Person(UUID id, String email) {}
    public record Preview(boolean available, String sha256, Long size, Instant createdAt) {}
    public record DiscardedBy(String kind, String email, UUID agentRun) {}
    public record Actions(boolean edit, boolean preview, boolean submit, boolean apply, boolean restore, boolean discard,
                          Map<String, String> reasons) {}

    @ModelAttribute
    void noStore(HttpServletResponse response) { response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue()); }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Resource create(@PathVariable UUID project, Actor actor, @RequestBody Create body) {
        if (body == null || body.baseVersion() == null) throw new IllegalArgumentException("Falta la versión base");
        return resource(changes.create(actor, project, body.baseVersion(), body.description()));
    }

    @GetMapping
    public List<Resource> list(@PathVariable UUID project, Actor actor, @RequestParam(required = false) String status,
                               @RequestParam(required = false) UUID file) {
        return changes.list(actor, project, statuses(status), file).stream().map(this::resource).toList();
    }

    @GetMapping("/{id}")
    public Resource get(@PathVariable UUID project, @PathVariable UUID id, Actor actor) {
        return resource(changes.get(actor, project, id));
    }

    @PostMapping("/{id}/operations")
    @ResponseStatus(HttpStatus.CREATED)
    public Resource addOperation(@PathVariable UUID project, @PathVariable UUID id, Actor actor, @RequestBody String operation) {
        return resource(changes.addOperation(actor, project, id, recipes.operation(operation)));
    }

    @PutMapping("/{id}/operations/{op}")
    public Resource replaceOperation(@PathVariable UUID project, @PathVariable UUID id, @PathVariable String op, Actor actor,
                                     @RequestBody String operation) {
        return resource(changes.replaceOperation(actor, project, id, op, recipes.operation(operation)));
    }

    @DeleteMapping("/{id}/operations/{op}")
    public Resource removeOperation(@PathVariable UUID project, @PathVariable UUID id, @PathVariable String op, Actor actor) {
        return resource(changes.removeOperation(actor, project, id, op));
    }

    @PostMapping("/{id}/preview")
    public Resource preview(@PathVariable UUID project, @PathVariable UUID id, Actor actor) {
        return resource(changes.preview(actor, project, id));
    }

    /** The verified IFC of the current preview, named {@code <base>-propuesta.ifc}. */
    @GetMapping("/{id}/preview")
    public ResponseEntity<InputStreamResource> previewFile(@PathVariable UUID project, @PathVariable UUID id, Actor actor) {
        var file = changes.previewFile(actor, project, id);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentLength(file.size())
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.fileName(), StandardCharsets.UTF_8).build().toString())
            .body(new InputStreamResource(file.content()));
    }

    @PostMapping("/{id}/submit")
    public Resource submit(@PathVariable UUID project, @PathVariable UUID id, Actor actor, @RequestBody(required = false) Submit body) {
        return resource(changes.submit(actor, project, id, body == null ? null : body.summary()));
    }

    @PostMapping("/{id}/discard")
    public Resource discard(@PathVariable UUID project, @PathVariable UUID id, Actor actor, @RequestBody(required = false) Discard body) {
        return resource(changes.discard(actor, project, id, body == null ? null : body.reason()));
    }

    @PostMapping("/{id}/apply")
    public Resource apply(@PathVariable UUID project, @PathVariable UUID id, Actor actor) throws IOException {
        return resource(publish.apply(actor, project, id));
    }

    @PostMapping("/{id}/restore")
    public Resource restore(@PathVariable UUID project, @PathVariable UUID id, Actor actor) throws IOException {
        return resource(publish.restore(actor, project, id));
    }

    @GetMapping("/{id}/picture")
    public ResponseEntity<byte[]> picture(@PathVariable UUID project, @PathVariable UUID id, Actor actor) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).body(changes.picture(actor, project, id));
    }

    // Resource -------------------------------------------------------------------------------------------------------

    private Resource resource(ChangeView view) {
        var change = view.change();
        Map<String, Object> report = null;
        if (change.report() != null) {
            report = new LinkedHashMap<>(reports.tree(change.report()));
        }
        var stored = change.preview();
        var preview = stored == null ? new Preview(false, null, null, null)
            : new Preview(view.previewAvailable(), stored.sha256(), stored.size(), change.previewedAt());
        var applied = change.applied();
        var restored = change.restored();
        var discarded = change.discarded();
        var actions = view.actions();
        return new Resource(change.id(), change.project(), change.file(), change.baseVersion(), view.base().revision(), view.base().name(),
            change.format(), change.status(), change.origin().name(), person(view, change.author()), change.agentRun(),
            change.description(), change.summary(), recipes.tree(change.recipe()), report, view.reportCurrent(), preview,
            change.picture(), legacy(change.legacyReview()),
            applied == null ? null : applied.version(), applied == null ? null : applied.at(), applied == null ? null : person(view, applied.by()),
            restored == null ? null : restored.version(), restored == null ? null : restored.at(),
            restored == null ? null : person(view, restored.by()),
            discarded == null ? null : discarded.at(),
            discarded == null ? null : new DiscardedBy(discarded.kind().name(), view.email(discarded.by()),
                discarded.kind() == Actor.Kind.AGENT ? change.agentRun() : null),
            change.createdAt(), change.updatedAt(),
            new Actions(actions.edit(), actions.preview(), actions.submit(), actions.apply(), actions.restore(), actions.discard(),
                actions.reasons()));
    }

    private static Person person(ChangeView view, UUID user) { return user == null ? null : new Person(user, view.email(user)); }

    private JsonNode legacy(String review) {
        if (review == null) return null;
        try {
            var value = json.readTree(review);
            if (value instanceof com.fasterxml.jackson.databind.node.ObjectNode object) object.remove("estimate");
            return value;
        } catch (JsonProcessingException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** {@code DRAFT,READY} → the set; blank → every status; an unknown name → 400 {@code STATUS_INVALID}. */
    private static Set<ChangeStatus> statuses(String text) {
        if (text == null || text.isBlank()) return Set.of();
        var set = EnumSet.noneOf(ChangeStatus.class);
        for (var name : text.split(",")) {
            try {
                set.add(ChangeStatus.valueOf(name.strip()));
            } catch (IllegalArgumentException e) {
                throw new InvalidRequestApplicationException("STATUS_INVALID", "Estado desconocido: " + name.strip() + ".");
            }
        }
        return set;
    }
}
