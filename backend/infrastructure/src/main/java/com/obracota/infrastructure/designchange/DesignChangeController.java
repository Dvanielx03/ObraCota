package com.obracota.infrastructure.designchange;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.UnprocessableApplicationException;
import com.obracota.application.modelchange.usecase.ChangeView;
import com.obracota.application.modelchange.usecase.DoorReview;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.application.modelchange.usecase.VersionPrices;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.designchange.BimEditPort;
import com.obracota.domain.modelchange.model.price.PriceKey;
import com.obracota.domain.modelchange.model.price.UnitPrice;
import com.obracota.domain.modelchange.model.recipe.GlobalId;
import com.obracota.domain.security.model.Actor;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.io.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * The door routes of before H1, kept as a facade over {@code model_change} (§3.4): same paths, bodies and answers.
 * Every method receives the {@link Actor} resolved by {@code ActorArgumentResolver} and hands it to the use case, which
 * owns the transactions; nothing here opens one, so the preview of {@code POST /} never holds a connection.
 */
@RestController
@RequestMapping("/api/projects/{project}/design-changes")
public class DesignChangeController {
    private final ModelChanges changes;
    private final PublishModelChange publish;
    private final VersionPrices prices;
    private final ProjectVersions versions;
    private final ObjectMapper json;

    public DesignChangeController(ModelChanges changes, PublishModelChange publish, VersionPrices prices, ProjectVersions versions,
                                  ObjectMapper json) {
        this.changes = changes;
        this.publish = publish;
        this.prices = prices;
        this.versions = versions;
        this.json = json;
    }

    public record Price(String typeId, BigDecimal amount, String source, LocalDate date) {}
    public record Pricing(BigDecimal minimum, List<Price> prices) {}
    public record Proposal(UUID version, String element, String typeId, String description, String picture) {}
    public record Change(UUID id, UUID version, String description, DoorReview review, UUID applied, UUID restored, boolean picture) {}

    /** {@code HttpBimEdit} (behind {@code /door} and {@code /review}) still speaks {@link ResponseStatusException}. */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String,String>> conflict(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", Objects.requireNonNullElse(error.getReason(),"No se pudo completar el cambio.")));
    }

    @GetMapping("/door")
    public BimEditPort.Door door(@PathVariable UUID project, Actor actor, @RequestParam UUID version, @RequestParam String element) throws IOException {
        return changes.door(actor, project, version, element);
    }

    @GetMapping("/pricing")
    public Pricing prices(@PathVariable UUID project, Actor actor, @RequestParam UUID version) {
        requireIfc(project, actor, version);
        return pricing(prices.read(actor, project, version));
    }

    @PutMapping("/pricing")
    public Pricing savePricing(@PathVariable UUID project, Actor actor, @RequestParam UUID version, @RequestBody Pricing input) {
        requireIfc(project, actor, version);
        List<UnitPrice> typed = null;
        if (input.prices() != null) {
            if (input.prices().size() > VersionPrices.LIMIT) throw new IllegalArgumentException("Como máximo " + VersionPrices.LIMIT + " precios");
            typed = new ArrayList<>();
            for (var price : input.prices()) {
                if (price == null || !GlobalId.valid(price.typeId()) || price.date() == null) throw new IllegalArgumentException("Precio inválido");
                if (price.source() != null && price.source().length() > UnitPrice.SOURCE_LIMIT) throw new IllegalArgumentException("Fuente inválida");
                typed.add(new UnitPrice(PriceKey.type(price.typeId()), UnitPrice.Unit.UNIT, UnitPrice.COP, price.amount(), price.source(),
                    price.date(), null));
            }
        }
        return pricing(prices.replace(actor, project, version, input.minimum(), typed));
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

    @PostMapping("/{id}/apply")
    public Change apply(@PathVariable UUID project, @PathVariable UUID id, Actor actor) throws IOException {
        return change(publish.apply(actor, project, id));
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
                review = json.readValue(change.legacyReview(), DoorReview.class);
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

    private static Pricing pricing(VersionPrices.PriceList list) {
        var doors = list.prices().stream().filter(price -> price.key().isType() && price.unit() == UnitPrice.Unit.UNIT)
            .map(price -> new Price(price.key().typeId().orElseThrow(), price.amount(), price.source(), price.date())).toList();
        return new Pricing(list.minimumWidth(), doors);
    }

    private void requireIfc(UUID project, Actor actor, UUID version) {
        if (!"IFC".equals(versions.get(project, actor.user(), version).format()))
            throw new UnprocessableApplicationException("FORMAT_NOT_SUPPORTED", "Selecciona una versión IFC.");
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
