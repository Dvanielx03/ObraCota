package com.obracota.infrastructure.modelchange.adapters.out.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.application.common.exception.*;
import com.obracota.domain.modelchange.model.recipe.ChangeType;
import com.obracota.domain.modelchange.model.recipe.PropertyScope;
import com.obracota.domain.modelchange.model.recipe.PropertyValue;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.recipe.SetProperty;
import com.obracota.domain.modelchange.port.ModelEnginePort.ElementQuery;
import com.obracota.domain.modelchange.port.ModelEnginePort.VersionRef;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.http.HttpTimeoutException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/** J12: the IFC engine adapter against a local {@link HttpServer}: request shapes, {@code /build} headers and error mapping. */
class IfcEngineContractTest {
    static final String SHA = "a".repeat(64), OUT = "b".repeat(64);
    static final UUID PROJECT = UUID.randomUUID(), VERSION = UUID.randomUUID();
    static final VersionRef BASE = new VersionRef(PROJECT, VERSION, SHA);
    static final Recipe RECIPE = Recipe.empty()
        .append(new ChangeType(null, "1hOSvn6df7F8_7GcBWlS8Z", "2klOFZffH6WQFlV10uM1wF"))
        .append(new SetProperty(null, "1hOSvn6df7F8_7GcBWlS8Z", PropertyScope.OCCURRENCE, "Pset_DoorCommon", "FireRating",
            new PropertyValue.Text("EI 60"), null));

    final ObjectMapper json = new ObjectMapper();
    final AtomicReference<HttpExchange> seen = new AtomicReference<>();
    final AtomicReference<JsonNode> body = new AtomicReference<>();
    HttpServer server;
    IfcEngineHttpAdapter adapter;

    interface Answer { void send(HttpExchange exchange) throws IOException; }

    @BeforeEach void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        adapter = new IfcEngineHttpAdapter("http://127.0.0.1:" + server.getAddress().getPort(), Duration.ofSeconds(10),
            Duration.ofSeconds(10), new JacksonRecipeCodec());
    }

    @AfterEach void stop() { server.stop(0); }

    void route(String path, Answer answer) {
        server.createContext(path, exchange -> {
            seen.set(exchange);
            var bytes = exchange.getRequestBody().readAllBytes();
            body.set(bytes.length == 0 ? null : json.readTree(bytes));
            answer.send(exchange);
        });
    }

    static Answer reply(int status, String text) {
        return exchange -> {
            var bytes = text.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", text.startsWith("{") ? "application/json" : "text/plain");
            exchange.sendResponseHeaders(status, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        };
    }

    @Test void readingsSendTheVersionReferenceAndReturnTheTree() {
        route("/summary", reply(200, "{\"schema\":\"IFC2X3\",\"counts\":{\"IfcDoor\":14},\"cache\":{\"hit\":false,\"open_ms\":812}}"));
        var summary = adapter.summary(BASE);
        assertEquals("IFC2X3", summary.get("schema"));
        assertEquals(14, ((Map<?, ?>) summary.get("counts")).get("IfcDoor"));
        var query = seen.get().getRequestURI().getQuery();
        assertTrue(query.contains("project=" + PROJECT) && query.contains("version=" + VERSION) && query.contains("sha256=" + SHA), query);
        assertEquals("GET", seen.get().getRequestMethod());

        route("/elements", reply(200, "{\"items\":[],\"total\":0,\"next_cursor\":null}"));
        var page = adapter.elements(BASE, new ElementQuery("IfcDoor", null, "Level 1", "IfcDoor, Name=P*", 20, "40"));
        assertTrue(page.containsKey("next_cursor"));
        assertNull(page.get("next_cursor"));
        var elements = seen.get().getRequestURI().getRawQuery();
        assertTrue(elements.contains("ifc_class=IfcDoor") && elements.contains("limit=20") && elements.contains("cursor=40")
            && elements.contains("storey=Level%201") && !elements.contains("name="), elements);

        route("/element", reply(200, "{\"guid\":\"1hOSvn6df7F8_7GcBWlS8Z\",\"class\":\"IfcDoor\"}"));
        assertEquals("IfcDoor", adapter.element(BASE, "1hOSvn6df7F8_7GcBWlS8Z").get("class"));
        assertTrue(seen.get().getRequestURI().getQuery().contains("guid=1hOSvn6df7F8_7GcBWlS8Z"));
    }

    @Test void sendsTheSharedTokenOnlyWhenConfigured() {
        route("/summary", reply(200, "{\"schema\":\"IFC4\"}"));
        adapter.summary(BASE);
        assertNull(seen.get().getRequestHeaders().getFirst("Authorization"), "without a token no header is sent");

        var guarded = new IfcEngineHttpAdapter("http://127.0.0.1:" + server.getAddress().getPort(), Duration.ofSeconds(10),
            Duration.ofSeconds(10), new JacksonRecipeCodec(), " s3cr3t ");
        guarded.summary(BASE);
        assertEquals("Bearer s3cr3t", seen.get().getRequestHeaders().getFirst("Authorization"));
        route("/preview", reply(200, "{\"ok\":true,\"operations\":[]}"));
        guarded.check(BASE, RECIPE);
        assertEquals("Bearer s3cr3t", seen.get().getRequestHeaders().getFirst("Authorization"));
    }

    @Test void checksOnlySendsTheRecipeAndReadsEachOperation() {
        route("/preview", reply(200, """
            {"ok":false,"operations":[{"id":"op-1","op":"ifc.change_type","ok":true,"element":"1hOSvn6df7F8_7GcBWlS8Z","errors":[]},
             {"id":"op-2","op":"ifc.set_property","ok":false,"element":"1hOSvn6df7F8_7GcBWlS8Z",
              "errors":[{"code":"VALUE_TYPE","detail":"IsExternal es un booleano."}]}]}"""));
        var checks = adapter.check(BASE, RECIPE);
        assertFalse(checks.ok());
        assertEquals("VALUE_TYPE", checks.operations().get(1).firstError().orElseThrow().code());
        var sent = body.get();
        assertEquals("POST", seen.get().getRequestMethod());
        assertTrue(sent.get("checks_only").asBoolean());
        assertEquals(PROJECT.toString(), sent.get("project").asText());
        assertEquals(VERSION.toString(), sent.get("version").asText());
        assertEquals(SHA, sent.get("sha256").asText());
        assertEquals("obracota.recipe/1", sent.at("/recipe/format").asText());
        assertEquals("2klOFZffH6WQFlV10uM1wF", sent.at("/recipe/operations/0/type_id").asText());
        assertEquals("occurrence", sent.at("/recipe/operations/1/scope").asText());
        assertTrue(sent.at("/recipe/operations/1/price_key").isNull());
        assertEquals("op-2", sent.at("/recipe/operations/1/id").asText());
    }

    @Test void previewReadsTheTypedSectionsAndKeepsTheRest() {
        route("/preview", reply(200, """
            {"ok":true,"engine":{"version":"h1.0"},"base":{"version":"v","sha256":"s","schema":"IFC2X3"},"recipe_sha256":"r",
             "artifact":{"id":"0123456789abcdef0123456789abcdef","sha256":"%s","size":2380572,"expires_at":"2026-11-21T15:17:11Z"},
             "operations":[{"id":"op-1","op":"ifc.change_type","ok":true,"element":"1hOSvn6df7F8_7GcBWlS8Z","errors":[],
               "before":{"element":"1hOSvn6df7F8_7GcBWlS8Z","width":0.762},"after":{"typeId":"2klOFZffH6WQFlV10uM1wF"},
               "findings":[],"declared":[]}],
             "affected":[{"guid":"1hOSvn6df7F8_7GcBWlS8Z"}],
             "findings":[{"rule":"ASSIGN_TYPE_CLEARED_ATTRIBUTES","status":"WARNING","explanation":"x","source":"y","element":"z"}],
             "quantities":[{"element":"1hOSvn6df7F8_7GcBWlS8Z","phase":"after","quantity":1,"unit":"UNIT","source":"UNIT","basis":"b","reliable":true}],
             "diff":{"changed":[]},"validation":{"layers":[]},"errors":[],"timings_ms":{"open":3}}""".formatted(OUT)));
        var report = adapter.preview(BASE, RECIPE);
        assertFalse(body.get().get("checks_only").asBoolean());
        assertTrue(report.ok());
        assertEquals(OUT, report.artifact().sha256());
        assertEquals(2380572, report.artifact().size());
        assertEquals(Instant.parse("2026-11-21T15:17:11Z"), report.artifact().expiresAt());
        assertEquals(new BigDecimal("0.762"), report.operations().getFirst().before().get("width"));
        assertEquals("ASSIGN_TYPE_CLEARED_ATTRIBUTES", report.findings().getFirst().rule());
        assertEquals(0, BigDecimal.ONE.compareTo(report.quantities().getFirst().quantity()));
        assertEquals(Set.of("engine", "base", "affected", "diff", "validation", "errors", "timings_ms"), report.details().keySet());
    }

    @Test void anOkReportWithoutArtifactIsOutsideTheContract() {
        route("/preview", reply(200, "{\"ok\":true,\"operations\":[]}"));
        assertThrows(EngineContractException.class, () -> adapter.preview(BASE, RECIPE));
    }

    @Test void buildStreamsTheBytesWithItsHeaders() throws IOException {
        var bytes = "ISO-10303-21;\n/* rev 2 */".getBytes(StandardCharsets.UTF_8);
        route("/build", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/octet-stream");
            exchange.getResponseHeaders().add("x-obracota-output-sha256", OUT.toUpperCase(Locale.ROOT));
            exchange.getResponseHeaders().add("x-obracota-recipe-sha256", "r");
            exchange.getResponseHeaders().add("x-obracota-rebuilt", "false");
            exchange.sendResponseHeaders(200, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        try (var build = adapter.build(BASE, RECIPE, "0123456789abcdef0123456789abcdef")) {
            assertArrayEquals(bytes, build.content().readAllBytes());
            assertEquals(bytes.length, build.size());
            assertEquals(OUT, build.sha256());
            assertEquals("r", build.recipeSha256());
            assertFalse(build.rebuilt());
        }
        assertEquals("0123456789abcdef0123456789abcdef", body.get().get("artifact").asText());
        assertEquals("obracota.recipe/1", body.get().at("/recipe/format").asText());
    }

    /** The request timeout only covers the headers: a body that stalls ends at the same deadline, without leaking the interrupt. */
    @Test void aBuildBodyThatStallsEndsAtTheDeadline() throws IOException {
        var release = new CountDownLatch(1);
        route("/build", exchange -> {
            exchange.getResponseHeaders().add("x-obracota-output-sha256", OUT);
            exchange.getResponseHeaders().add("x-obracota-recipe-sha256", "r");
            exchange.getResponseHeaders().add("x-obracota-rebuilt", "true");
            exchange.sendResponseHeaders(200, 1000);
            var out = exchange.getResponseBody();
            out.write("ISO-10303-21;".getBytes(StandardCharsets.UTF_8));
            out.flush();
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            exchange.close();
        });
        try (var build = adapter.build(BASE, RECIPE, "0123456789abcdef0123456789abcdef", Duration.ofMillis(800))) {
            long started = System.nanoTime();
            assertThrows(HttpTimeoutException.class, () -> build.content().readAllBytes());
            assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(5)) < 0, "it did not wait for the engine");
            assertFalse(Thread.interrupted(), "the watchdog's interrupt is cleared before the read returns");
            assertThrows(HttpTimeoutException.class, () -> build.content().read(), "once late, it stays late");
        } finally {
            release.countDown();
        }
    }

    @Test void anEmptyBudgetNeverCallsTheEngine() {
        route("/preview", reply(200, "{\"ok\":false,\"operations\":[]}"));
        var late = assertThrows(EngineUnavailableException.class, () -> adapter.preview(BASE, RECIPE, Duration.ZERO));
        assertEquals(IfcEngineHttpAdapter.TIMEOUT, late.getMessage());
        assertNull(seen.get());
    }

    @Test void buildWithoutItsHeadersIsOutsideTheContract() {
        route("/build", reply(200, "ISO-10303-21;"));
        assertThrows(EngineContractException.class, () -> adapter.build(BASE, RECIPE, null));
        assertTrue(body.get().get("artifact").isNull());
    }

    @Test void eachEngineErrorBecomesItsException() {
        route("/summary", reply(400, "{\"detail\":\"Selector inválido.\",\"code\":\"SELECTOR_INVALID\"}"));
        var invalid = assertThrows(InvalidRequestApplicationException.class, () -> adapter.summary(BASE));
        assertEquals("SELECTOR_INVALID", invalid.code());
        assertEquals("Selector inválido.", invalid.getMessage());

        route("/element", reply(404, "{\"detail\":\"La pieza no existe en este IFC.\",\"code\":\"ELEMENT_NOT_FOUND\"}"));
        assertEquals("La pieza no existe en este IFC.",
            assertThrows(NotFoundApplicationException.class, () -> adapter.element(BASE, "1hOSvn6df7F8_7GcBWlS8Z")).getMessage());

        route("/elements", reply(409, "{\"detail\":\"El archivo no coincide con su SHA-256.\",\"code\":\"SHA_MISMATCH\"}"));
        assertEquals("El archivo no coincide con su SHA-256.",
            assertThrows(ConflictApplicationException.class, () -> adapter.elements(BASE, null)).getMessage());

        route("/preview", reply(422, "{\"detail\":\"El modelo supera el tamaño que H1 puede verificar (190 MB).\",\"code\":\"MODEL_TOO_LARGE\"}"));
        var large = assertThrows(UnprocessableApplicationException.class, () -> adapter.preview(BASE, RECIPE));
        assertEquals("MODEL_TOO_LARGE", large.code());
        assertTrue(large.getMessage().contains("190 MB"));

        route("/build", reply(503, "{\"detail\":\"El motor está ocupado.\",\"code\":\"ENGINE_BUSY\"}"));
        var busy = assertThrows(EngineUnavailableException.class, () -> adapter.build(BASE, RECIPE, null));
        assertEquals("ENGINE_BUSY", busy.code());

        route("/diff", reply(500, "Internal Server Error"));
        assertThrows(EngineContractException.class, () -> adapter.diff(PROJECT, BASE, BASE));
    }

    @Test void a500WithoutJsonIsAContractErrorNotUnavailable() {
        route("/preview", reply(500, "Internal Server Error"));
        assertThrows(EngineContractException.class, () -> adapter.preview(BASE, RECIPE));
        route("/summary", reply(200, "not json"));
        assertThrows(EngineContractException.class, () -> adapter.summary(BASE));
    }

    @Test void noEngineIsUnavailable() throws IOException {
        int port;
        try (var socket = new ServerSocket(0)) { port = socket.getLocalPort(); }
        var down = new IfcEngineHttpAdapter("http://127.0.0.1:" + port, Duration.ofSeconds(5), Duration.ofSeconds(5), new JacksonRecipeCodec());
        var error = assertThrows(EngineUnavailableException.class, () -> down.summary(BASE));
        assertNull(error.code());
        assertEquals(IfcEngineHttpAdapter.UNAVAILABLE, error.getMessage());
    }
}
