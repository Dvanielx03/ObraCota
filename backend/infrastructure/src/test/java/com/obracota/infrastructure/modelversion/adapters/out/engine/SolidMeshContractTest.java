package com.obracota.infrastructure.modelversion.adapters.out.engine;

import com.obracota.application.common.exception.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/** The DWG solids adapter against a local {@link HttpServer}: request shape, the mesh's identity headers and error mapping. */
class SolidMeshContractTest {
    static final String SHA = "c".repeat(64), TESSELLATOR = "acis-occt-1";
    static final UUID PROJECT = UUID.randomUUID(), VERSION = UUID.randomUUID();
    static final byte[] MESH = {0x1f, (byte) 0x8b, 8, 0, 1, 2, 3, 4};

    final AtomicReference<HttpExchange> seen = new AtomicReference<>();
    HttpServer server;
    SolidMeshHttpAdapter adapter;

    interface Answer { void send(HttpExchange exchange) throws IOException; }

    @BeforeEach void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        adapter = new SolidMeshHttpAdapter(url(), Duration.ofSeconds(10), 1 << 20);
    }

    @AfterEach void stop() { server.stop(0); }

    String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }

    void route(Answer answer) {
        server.createContext("/dwg/solids", exchange -> {
            seen.set(exchange);
            exchange.getRequestBody().readAllBytes();
            answer.send(exchange);
        });
    }

    void unroute() {
        try { server.removeContext("/dwg/solids"); } catch (IllegalArgumentException none) { }
    }

    static Answer mesh(String source, String tessellator) {
        return exchange -> {
            var headers = exchange.getResponseHeaders();
            headers.add("Content-Type", "application/gzip");
            headers.add("X-ObraCota-Format", "obracota.dwg-solids/1");
            if (source != null) headers.add("X-ObraCota-Source-Sha256", source);
            if (tessellator != null) headers.add("X-ObraCota-Tessellator", tessellator);
            headers.add("ETag", "\"" + source + "." + tessellator + "\"");
            exchange.sendResponseHeaders(200, MESH.length);
            try (var out = exchange.getResponseBody()) { out.write(MESH); }
        };
    }

    static Answer error(int status, String text) {
        return exchange -> {
            var bytes = text.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", text.startsWith("{") ? "application/json" : "text/plain");
            exchange.sendResponseHeaders(status, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        };
    }

    @Test void sendsTheVersionReferenceAndPassesTheMeshThrough() throws IOException {
        route(mesh(SHA, TESSELLATOR));
        try (var mesh = adapter.solids(PROJECT, VERSION, SHA)) {
            assertArrayEquals(MESH, mesh.content().readAllBytes());
            assertEquals(MESH.length, mesh.size());
            assertEquals(SHA, mesh.sourceSha256());
            assertEquals(TESSELLATOR, mesh.tessellator());
            assertEquals("obracota.dwg-solids/1", mesh.format());
            assertEquals("application/gzip", mesh.mediaType());
            assertEquals("\"" + SHA + "." + TESSELLATOR + "\"", mesh.etag());
        }
        var query = seen.get().getRequestURI().getQuery();
        assertEquals("GET", seen.get().getRequestMethod());
        assertTrue(query.contains("project=" + PROJECT) && query.contains("version=" + VERSION) && query.contains("sha256=" + SHA), query);
        assertNull(seen.get().getRequestHeaders().getFirst("Authorization"));
    }

    @Test void sendsTheSharedTokenWhenConfigured() throws IOException {
        route(mesh(SHA, TESSELLATOR));
        var guarded = new SolidMeshHttpAdapter(url(), Duration.ofSeconds(10), 1 << 20, " s3cr3t ");
        try (var ignored = guarded.solids(PROJECT, VERSION, SHA)) {
            assertEquals("Bearer s3cr3t", seen.get().getRequestHeaders().getFirst("Authorization"));
        }
    }

    @Test void passesIfNoneMatchOnAndMapsTheEngines304() throws IOException {
        var tag = "\"" + SHA + "." + TESSELLATOR + "\"";
        route(exchange -> {
            var headers = exchange.getResponseHeaders();
            headers.add("ETag", tag);
            headers.add("X-ObraCota-Format", "obracota.dwg-solids/1");
            headers.add("X-ObraCota-Source-Sha256", SHA);
            headers.add("X-ObraCota-Tessellator", TESSELLATOR);
            exchange.sendResponseHeaders(304, -1);
            exchange.close();
        });
        try (var mesh = adapter.solids(PROJECT, VERSION, SHA, "W/" + tag)) {
            assertTrue(mesh.notModified());
            assertEquals(tag, mesh.etag());
            assertEquals(0, mesh.content().readAllBytes().length);
        }
        assertEquals("W/" + tag, seen.get().getRequestHeaders().getFirst("If-None-Match"));
        assertThrows(EngineContractException.class, () -> adapter.solids(PROJECT, VERSION, SHA), "304 without asking");
    }

    @Test void anUnsafeIfNoneMatchIsNotPassedOn() throws IOException {
        route(mesh(SHA, TESSELLATOR));
        try (var mesh = adapter.solids(PROJECT, VERSION, SHA, "\"x\"é")) {
            assertFalse(mesh.notModified());
        }
        assertNull(seen.get().getRequestHeaders().getFirst("If-None-Match"));
        assertFalse(SolidMeshHttpAdapter.forwardable("x".repeat(1025)));
        assertTrue(SolidMeshHttpAdapter.forwardable("\"a\", W/\"b\""));
    }

    @Test void aMeshWithoutItsIdentityIsAContractError() {
        route(mesh("d".repeat(64), TESSELLATOR));
        assertThrows(EngineContractException.class, () -> adapter.solids(PROJECT, VERSION, SHA), "mesh of another file");
        unroute();
        route(mesh(SHA, null));
        assertThrows(EngineContractException.class, () -> adapter.solids(PROJECT, VERSION, SHA), "no tessellator");
    }

    @Test void aMeshAboveTheLimitIsAContractError() {
        route(mesh(SHA, TESSELLATOR));
        var small = new SolidMeshHttpAdapter(url(), Duration.ofSeconds(10), 4);
        assertThrows(EngineContractException.class, () -> small.solids(PROJECT, VERSION, SHA));
    }

    @Test void mapsTheEngineErrors() {
        record Case(int status, String body, Class<? extends RuntimeException> expected, String code) {}
        var cases = new Case[]{
            new Case(400, "{\"detail\":\"Falta el parámetro sha256.\",\"code\":\"PARAMS_INVALID\"}", InvalidRequestApplicationException.class, "PARAMS_INVALID"),
            new Case(404, "{\"detail\":\"Versión no disponible.\",\"code\":\"VERSION_NOT_FOUND\"}", NotFoundApplicationException.class, null),
            new Case(409, "{\"detail\":\"El archivo no coincide.\",\"code\":\"SHA_MISMATCH\"}", ConflictApplicationException.class, null),
            new Case(422, "{\"detail\":\"La versión no es un DWG.\",\"code\":\"NOT_DWG\"}", UnprocessableApplicationException.class, "NOT_DWG"),
            new Case(422, "{\"detail\":\"Demasiados triángulos.\",\"code\":\"MESH_TOO_LARGE\"}", UnprocessableApplicationException.class, "MESH_TOO_LARGE"),
            new Case(503, "{\"detail\":\"Ocupado.\",\"code\":\"ENGINE_BUSY\"}", EngineUnavailableException.class, "ENGINE_BUSY"),
            new Case(503, "upstream down", EngineUnavailableException.class, null),
            new Case(500, "Internal Server Error", EngineContractException.class, null),
            new Case(422, "{\"code\":\"NOT_DWG\"}", EngineContractException.class, null),
        };
        for (var c : cases) {
            unroute();
            route(error(c.status(), c.body()));
            var thrown = assertThrows(c.expected(), () -> adapter.solids(PROJECT, VERSION, SHA), c.body());
            if (thrown instanceof UnprocessableApplicationException u) assertEquals(c.code(), u.code());
            if (thrown instanceof InvalidRequestApplicationException i) assertEquals(c.code(), i.code());
            if (thrown instanceof EngineUnavailableException e) assertEquals(c.code(), e.code());
        }
    }

    @Test void noEngineIsUnavailable() throws IOException {
        int port;
        try (var socket = new java.net.ServerSocket(0)) { port = socket.getLocalPort(); }
        var nowhere = new SolidMeshHttpAdapter("http://127.0.0.1:" + port, Duration.ofSeconds(5), 1 << 20);
        assertThrows(EngineUnavailableException.class, () -> nowhere.solids(PROJECT, VERSION, SHA));
    }
}
