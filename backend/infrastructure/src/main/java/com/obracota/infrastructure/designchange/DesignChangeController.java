package com.obracota.infrastructure.designchange;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.application.modelchange.usecase.ChangeView;
import com.obracota.application.modelchange.usecase.DoorReview;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.application.modelchange.usecase.ConfigureDoorMinimum;
import com.obracota.domain.designchange.DoorInspectionPort;
import com.obracota.domain.security.model.Actor;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.io.*;
import java.math.BigDecimal;
import java.util.*;

/**
 * The door routes of before H1, kept as a facade over {@code model_change} (§3.4): same paths, bodies and answers.
 * {@code POST /{id}/apply} was retired in R4: a door change is approved and published through
 * {@code /model-changes/{id}/apply}, which publishes the verified preview.
 * Every method receives the {@link Actor} resolved by {@code ActorArgumentResolver} and hands it to the use case, which
 * owns the transactions; nothing here opens one, so the preview of {@code POST /} never holds a connection.
 */
@RestController
@RequestMapping("/api/projects/{project}/design-changes")
public class DesignChangeController {
    private final ModelChanges changes;
    private final PublishModelChange publish;
    private final ConfigureDoorMinimum minimum;
    private final ObjectMapper json;

    public DesignChangeController(ModelChanges changes, PublishModelChange publish, ConfigureDoorMinimum minimum,
                                  ObjectMapper json) {
        this.changes = changes;
        this.publish = publish;
        this.minimum = minimum;
        this.json = json;
    }

    public record Proposal(UUID version, String element, String typeId, String description, String picture) {}
    public record Change(UUID id, UUID version, String description, DoorReview review, UUID applied, UUID restored, boolean picture) {}

    /** {@code HttpDoorInspection} (behind {@code /door} and {@code /review}) still speaks {@link ResponseStatusException}. */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,String>> conflict(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", Objects.requireNonNullElse(error.getReason(),"No se pudo completar el cambio.")));
    }

    @GetMapping("/door")
    public DoorInspectionPort.Door door(@PathVariable UUID project, Actor actor, @RequestParam UUID version, @RequestParam String element) throws IOException {
        return changes.door(actor, project, version, element);
    }

    public record MinimumWidth(BigDecimal minimum) {}

    @PutMapping("/minimum-width")
    public ResponseEntity<Void> saveMinimum(@PathVariable UUID project, Actor actor, @RequestBody MinimumWidth input) {
        minimum.set(actor, project, input.minimum());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/review")
    public DoorReview review(@PathVariable UUID project, Actor actor, @RequestParam UUID version, @RequestParam String element,
                             @RequestParam String typeId) throws IOException {
        return changes.doorReview(actor, project, version, element, typeId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Change propose(@PathVariable UUID project, Actor actor, @RequestBody Proposal input) throws IOException {
        var view = changes.proposeDoor(actor, project, input.version(), input.element(), input.typeId(), input.description(),
            picture(input.picture()), this::legacy);
        return change(view);
    }

    @GetMapping
    public List<Change> list(@PathVariable UUID project, Actor actor) {
        return changes.doorChanges(actor, project).stream().map(this::change).toList();
    }

    @GetMapping("/{id}/picture")
    public ResponseEntity<byte[]> illustration(@PathVariable UUID project, @PathVariable UUID id, Actor actor) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).body(changes.picture(actor, project, id));
    }

    @PostMapping("/{id}/restore")
    public Change restore(@PathVariable UUID project, @PathVariable UUID id, Actor actor) throws IOException {
        return change(publish.restore(actor, project, id));
    }

    private Change change(ChangeView view) {
        var change = view.change();
        DoorReview review = null;
        if (change.legacyReview() != null) {
            try {
                review = json.readerFor(DoorReview.class).without(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(change.legacyReview());
            } catch (JsonProcessingException e) {
                throw new UncheckedIOException(e);
            }
        }
        return new Change(change.id(), change.baseVersion(), change.description(), review,
            change.applied() == null ? null : change.applied().version(), change.restored() == null ? null : change.restored().version(),
            change.picture());
    }

    private String legacy(DoorReview review) {
        try {
            return json.writeValueAsString(review);
        } catch (JsonProcessingException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static byte[] picture(String data) {
        if (data == null || data.isBlank()) return null;
        if (data.length() > 6_000_000) throw new IllegalArgumentException();
        byte[] bytes = Base64.getDecoder().decode(data);
        byte[] signature = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
        if (bytes.length < 24 || !Arrays.equals(Arrays.copyOf(bytes, 8), signature)) throw new IllegalArgumentException();
        return bytes;
    }
}
