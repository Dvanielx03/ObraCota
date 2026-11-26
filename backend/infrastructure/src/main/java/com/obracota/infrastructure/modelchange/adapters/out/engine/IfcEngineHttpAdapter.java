package com.obracota.infrastructure.modelchange.adapters.out.engine;

import com.obracota.application.common.exception.*;
import com.obracota.domain.modelchange.model.recipe.Recipe;
import com.obracota.domain.modelchange.model.report.PreviewReport;
import com.obracota.domain.modelchange.port.ModelEnginePort;
import com.obracota.infrastructure.modelchange.adapters.out.json.JacksonRecipeCodec;
import com.obracota.infrastructure.modelchange.adapters.out.json.ReportJson;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * {@link ModelEnginePort} over the IFC engine's HTTP API (§5). Every answer outside the contract becomes an
 * {@link EngineContractException} (502), never «unavailable»: only a failed connection, a timeout or a 503 of the
 * engine are an {@link EngineUnavailableException}. That is the trap of {@code HttpDoorInspection}, where a 500 without JSON
 * became a 503 because {@code readTree} throws an {@link IOException} (§5.10).
 */
@Component
class IfcEngineHttpAdapter implements ModelEnginePort {
    static final String UNAVAILABLE = "El motor IFC no está disponible en este momento.";
    static final String TIMEOUT = "El motor IFC no respondió a tiempo; vuelve a intentarlo.";
    private static final int ERROR_BODY_LIMIT = 64 * 1024;

    private final URI engine;
    private final Duration previewTimeout;
    private final Duration readTimeout;
    private final JacksonRecipeCodec recipes;
    private final String token;
    private final ReportJson reports = new ReportJson();
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    IfcEngineHttpAdapter(String engine, Duration previewTimeout, Duration readTimeout, JacksonRecipeCodec recipes) {
        this(engine, previewTimeout, readTimeout, recipes, "");
    }

    /** {@code token} goes as {@code Authorization: Bearer} on every request; blank sends none (engine without token). */
    @Autowired
    IfcEngineHttpAdapter(@Value("${IFC_ENGINE_URL:http://localhost:8000}") String engine,
                         @Value("${ifc.engine.preview-timeout:PT220S}") Duration previewTimeout,
                         @Value("${ifc.engine.read-timeout:PT60S}") Duration readTimeout,
                         JacksonRecipeCodec recipes,
                         @Value("${ENGINE_TOKEN:}") String token) {
        this.engine = URI.create(engine);
        this.previewTimeout = previewTimeout;
        this.readTimeout = readTimeout;
        this.recipes = recipes;
        this.token = token == null ? "" : token.strip();
    }

    @Override
    public Map<String, Object> summary(VersionRef version) {
        return tree(get(reading("/summary", version), readTimeout));
    }

    @Override
    public Map<String, Object> elements(VersionRef version, ElementQuery query) {
        var uri = reading("/elements", version);
        if (query != null) {
            optional(uri, "ifc_class", query.ifcClass());
            optional(uri, "name", query.name());
            optional(uri, "storey", query.storey());
            optional(uri, "query", query.query());
            optional(uri, "limit", query.limit());
            optional(uri, "cursor", query.cursor());
        }
        return tree(get(uri, readTimeout));
    }

    @Override
    public Map<String, Object> element(VersionRef version, String guid) {
        return tree(get(reading("/element", version).queryParam("guid", guid), readTimeout));
    }

    @Override
    public Map<String, Object> dwgEntity(VersionRef version, String handle) {
        return tree(get(reading("/dwg/entity", version).queryParam("handle", handle), readTimeout));
    }

    @Override
    public Checks check(VersionRef base, Recipe recipe) {
        var body = previewBody(base, recipe);
        body.put("checks_only", true);
        var tree = tree(post("/preview", body, readTimeout));
        return contract(() -> new Checks(bool(tree.get("ok")), reports.checks(tree)));
    }

    @Override
    public PreviewReport preview(VersionRef base, Recipe recipe) {
        return preview(base, recipe, previewTimeout);
    }

    @Override
    public PreviewReport preview(VersionRef base, Recipe recipe, Duration timeout) {
        var body = previewBody(base, recipe);
        body.put("checks_only", false);
        var tree = tree(post("/preview", body, within(timeout)));
        return contract(() -> reports.report(tree));
    }

    @Override
    public Build build(VersionRef base, Recipe recipe, String artifact) {
        return build(base, recipe, artifact, previewTimeout);
    }

    /**
     * The request timeout of {@link HttpRequest} only covers the headers, so the streamed body gets a watchdog with the
     * same deadline: when it fires, the next or the blocked read ends with an {@link IOException}.
     */
    @Override
    public Build build(VersionRef base, Recipe recipe, String artifact, Duration timeout) {
        var limit = within(timeout);
        long deadline = System.nanoTime() + limit.toNanos();
        var body = previewBody(base, recipe);
        body.put("artifact", artifact);
        var response = send(request(URI.create(engine + "/build"), limit).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(reports.write(body))).build(), HttpResponse.BodyHandlers.ofInputStream());
        var content = response.body();
        try {
            long left = deadline - System.nanoTime();
            if (left <= 0) throw new EngineUnavailableException(null, TIMEOUT);
            content = new DeadlineInputStream(content, left);
            if (response.statusCode() != 200) throw failure(response.statusCode(), limited(content));
            var headers = response.headers();
            var sha = headers.firstValue("X-ObraCota-Output-Sha256").orElse(null);
            var recipeSha = headers.firstValue("X-ObraCota-Recipe-Sha256").orElse(null);
            var rebuilt = headers.firstValue("X-ObraCota-Rebuilt").orElse(null);
            var length = headers.firstValueAsLong("Content-Length");
            if (sha == null || !sha.matches("[0-9a-fA-F]{64}") || recipeSha == null || length.isEmpty() || length.getAsLong() < 0
                || !("true".equals(rebuilt) || "false".equals(rebuilt)))
                throw new EngineContractException("/build answered without its headers");
            return new Build(content, length.getAsLong(), sha.toLowerCase(Locale.ROOT), recipeSha, Boolean.parseBoolean(rebuilt));
        } catch (RuntimeException e) {
            closeQuietly(content);
            throw e;
        }
    }

    @Override
    public Map<String, Object> diff(UUID project, VersionRef base, VersionRef revision) {
        var body = new LinkedHashMap<String, Object>();
        body.put("project", project.toString());
        body.put("base", Map.of("version", base.version().toString(), "sha256", base.sha256()));
        body.put("revision", Map.of("version", revision.version().toString(), "sha256", revision.sha256()));
        return tree(post("/diff", body, previewTimeout));
    }

    // HTTP -----------------------------------------------------------------------------------------------------------

    private UriComponentsBuilder reading(String path, VersionRef version) {
        return UriComponentsBuilder.fromUri(engine).path(path).queryParam("project", version.project())
            .queryParam("version", version.version()).queryParam("sha256", version.sha256());
    }

    private static void optional(UriComponentsBuilder uri, String name, Object value) {
        if (value != null) uri.queryParam(name, value);
    }

    private Map<String, Object> previewBody(VersionRef base, Recipe recipe) {
        var body = new LinkedHashMap<String, Object>();
        body.put("project", base.project().toString());
        body.put("version", base.version().toString());
        body.put("sha256", base.sha256());
        body.put("recipe", recipes.tree(recipe));
        return body;
    }

    private byte[] get(UriComponentsBuilder uri, Duration timeout) {
        return answer(send(request(uri.build().encode().toUri(), timeout).GET().build(), HttpResponse.BodyHandlers.ofByteArray()));
    }

    private byte[] post(String path, Map<String, Object> body, Duration timeout) {
        var request = request(URI.create(engine + path), timeout).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(reports.write(body), StandardCharsets.UTF_8)).build();
        return answer(send(request, HttpResponse.BodyHandlers.ofByteArray()));
    }

    private HttpRequest.Builder request(URI uri, Duration timeout) {
        var builder = HttpRequest.newBuilder(uri).timeout(timeout).header("Accept", "application/json");
        return token.isEmpty() ? builder : builder.header("Authorization", "Bearer " + token);
    }

    private byte[] answer(HttpResponse<byte[]> response) {
        if (response.statusCode() == 200) return response.body();
        throw failure(response.statusCode(), response.body());
    }

    private <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
        try {
            return client.send(request, handler);
        } catch (HttpTimeoutException e) {
            throw new EngineUnavailableException(null, TIMEOUT, e);
        } catch (IOException e) {
            throw new EngineUnavailableException(null, UNAVAILABLE, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EngineUnavailableException(null, UNAVAILABLE, e);
        }
    }

    /** The engine's error {@code {"detail", "code"}} as the exception the use cases expect. */
    private RuntimeException failure(int status, byte[] body) {
        String detail = null, code = null;
        try {
            var tree = reports.tree(body);
            if (tree.get("detail") instanceof String text && !text.isBlank()) detail = text;
            if (tree.get("code") instanceof String text && !text.isBlank()) code = text;
        } catch (IllegalArgumentException notJson) {
            if (status == 503) return new EngineUnavailableException(null, UNAVAILABLE);
            return new EngineContractException("Engine answered " + status + " without a JSON body");
        }
        if (status == 503) return new EngineUnavailableException(code, Objects.requireNonNullElse(detail, UNAVAILABLE));
        if (detail == null) return new EngineContractException("Engine answered " + status + " without a detail");
        return switch (status) {
            case 400 -> new InvalidRequestApplicationException(Objects.requireNonNullElse(code, "PARAMS_INVALID"), detail);
            case 404 -> new NotFoundApplicationException(detail);
            case 409 -> new ConflictApplicationException(detail);
            case 422 -> new UnprocessableApplicationException(Objects.requireNonNullElse(code, "MODEL_UNREADABLE"), detail);
            default -> new EngineContractException("Engine answered " + status + " (" + code + "): " + detail);
        };
    }

    private Map<String, Object> tree(byte[] body) {
        return contract(() -> reports.tree(body));
    }

    private static <T> T contract(java.util.function.Supplier<T> read) {
        try {
            return read.get();
        } catch (IllegalArgumentException | NullPointerException | ArithmeticException | java.time.format.DateTimeParseException e) {
            throw new EngineContractException("Engine answer outside the contract: " + e.getMessage(), e);
        }
    }

    private static boolean bool(Object value) {
        if (value instanceof Boolean flag) return flag;
        throw new IllegalArgumentException("ok is not a boolean");
    }

    private static byte[] limited(InputStream content) {
        try (content) {
            return content.readNBytes(ERROR_BODY_LIMIT);
        } catch (IOException e) {
            return new byte[0];
        }
    }

    private static void closeQuietly(InputStream content) {
        try { content.close(); } catch (IOException ignored) { }
    }

    /** The caller's budget, never above this adapter's own {@code ifc.engine.preview-timeout}. */
    private Duration within(Duration timeout) {
        if (timeout == null || timeout.compareTo(previewTimeout) > 0) return previewTimeout;
        if (timeout.isNegative() || timeout.isZero()) throw new EngineUnavailableException(null, TIMEOUT);
        return timeout;
    }

    private static final ScheduledExecutorService WATCHDOG = Executors.newSingleThreadScheduledExecutor(task -> {
        var thread = new Thread(task, "ifc-engine-build-watchdog");
        thread.setDaemon(true);
        return thread;
    });

    /**
     * A {@code /build} body that ends at a deadline. When the alarm fires it interrupts the thread blocked in a read
     * (the JDK's response stream waits on an interruptible queue) and closes the stream; the interrupt flag is cleared
     * again before the read returns, so it never leaks into the request thread's later work.
     */
    static final class DeadlineInputStream extends FilterInputStream {
        private final Object lock = new Object();
        private final ScheduledFuture<?> alarm;
        private volatile boolean expired;
        private Thread reader;

        DeadlineInputStream(InputStream in, long nanos) {
            super(in);
            alarm = WATCHDOG.schedule(this::expire, nanos, TimeUnit.NANOSECONDS);
        }

        private void expire() {
            expired = true;
            synchronized (lock) {
                if (reader != null) reader.interrupt();
            }
            closeQuietly(in);
        }

        @Override public int read() throws IOException {
            enter();
            try {
                return super.read();
            } catch (IOException e) {
                throw expired ? late(e) : e;
            } finally {
                leave();
            }
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            enter();
            try {
                return super.read(b, off, len);
            } catch (IOException e) {
                throw expired ? late(e) : e;
            } finally {
                leave();
            }
        }

        @Override public long transferTo(java.io.OutputStream out) throws IOException {
            long total = 0;
            byte[] block = new byte[65536];
            for (int n; (n = read(block, 0, block.length)) != -1; total += n) out.write(block, 0, n);
            return total;
        }

        @Override public void close() throws IOException {
            alarm.cancel(false);
            super.close();
        }

        private void enter() throws IOException {
            if (expired) throw late(null);
            synchronized (lock) {
                reader = Thread.currentThread();
            }
        }

        private void leave() {
            synchronized (lock) {
                reader = null;
            }
            if (expired) Thread.interrupted();
        }

        private static IOException late(IOException cause) {
            var late = new HttpTimeoutException("/build did not finish its body in time");
            if (cause != null) late.initCause(cause);
            return late;
        }
    }
}
