package com.obracota.infrastructure.assistant.adapters.out.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.ImageGenerationPort;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * Image edits on Cloudflare Workers AI with FLUX.2 [klein] 4B, inside the free daily allowance.
 * Selected with IMAGE_PROVIDER=cloudflare; the text model (option wording) stays on Gemini.
 * The model takes the screenshot as {@code input_image_0} but no mask, so the mask is applied here:
 * outside the marked area the original pixels are put back, and only the marked part can change.
 */
@Component
@Primary
@ConditionalOnProperty(name = "IMAGE_PROVIDER", havingValue = "cloudflare")
public class CloudflareImages implements ImageGenerationPort {
    static final String MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
    private static final int MAX_SIDE = 1024;
    private final ObjectMapper json;
    private final String account;
    private final String token;
    private final URI base;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    @org.springframework.beans.factory.annotation.Autowired
    public CloudflareImages(ObjectMapper json, @Value("${CLOUDFLARE_ACCOUNT_ID:}") String account,
                            @Value("${CLOUDFLARE_API_TOKEN:}") String token) {
        this(json, account, token, URI.create("https://api.cloudflare.com/client/v4/"));
    }

    CloudflareImages(ObjectMapper json, String account, String token, URI base) {
        this.json = json; this.account = account; this.token = token; this.base = base;
    }

    @Override public Image edit(String model, byte[] jpeg, String prompt) { return edit(model, jpeg, null, prompt); }

    @Override public Image edit(String model, byte[] jpeg, byte[] mask, String prompt) {
        if (account.isBlank() || token.isBlank()) throw new IllegalStateException("Configura CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN para generar imágenes.");
        try {
            BufferedImage source = ImageIO.read(new ByteArrayInputStream(jpeg));
            if (source == null) throw new IllegalArgumentException("La captura no es una imagen válida.");
            double scale = Math.min(1, (double) MAX_SIDE / Math.max(source.getWidth(), source.getHeight()));
            int width = Math.max(256, (int) Math.round(source.getWidth() * scale) / 16 * 16);
            int height = Math.max(256, (int) Math.round(source.getHeight() * scale) / 16 * 16);
            String boundary = "obracota-" + UUID.randomUUID();
            byte[] body = multipart(boundary, prompt, width, height, jpeg);
            HttpRequest request = HttpRequest.newBuilder(base.resolve("accounts/" + account + "/ai/run/" + MODEL))
                .timeout(Duration.ofSeconds(120))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 429) throw new IllegalStateException("HTTP_429");
            if (response.statusCode() / 100 != 2) throw new IllegalStateException("Cloudflare respondió " + response.statusCode());
            var tree = json.readTree(response.body());
            String b64 = tree.at("/result/image").asText("");
            if (b64.isEmpty()) throw new IllegalStateException("Cloudflare no devolvió una imagen.");
            byte[] generated = Base64.getDecoder().decode(b64);
            byte[] result = mask == null ? generated : keepOutsideMask(source, generated, mask);
            return new Image(result, mask == null ? mimeOf(generated) : "image/png", new Consumption(null, null, null));
        } catch (IOException e) {
            throw new IllegalStateException("No se pudo contactar a Cloudflare.", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Generación interrumpida.", e);
        }
    }

    private static byte[] multipart(String boundary, String prompt, int width, int height, byte[] jpeg) throws IOException {
        var out = new ByteArrayOutputStream();
        field(out, boundary, "prompt", prompt);
        field(out, boundary, "width", Integer.toString(width));
        field(out, boundary, "height", Integer.toString(height));
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"input_image_0\"; filename=\"captura.jpg\"\r\n"
            + "Content-Type: image/jpeg\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(jpeg);
        out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private static void field(ByteArrayOutputStream out, String boundary, String name, String value) throws IOException {
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n")
            .getBytes(StandardCharsets.UTF_8));
    }

    /** Pixels where the mask is dark keep the original screenshot; bright ones take the generated image. */
    static byte[] keepOutsideMask(BufferedImage source, byte[] generated, byte[] mask) throws IOException {
        BufferedImage edit = ImageIO.read(new ByteArrayInputStream(generated));
        BufferedImage area = ImageIO.read(new ByteArrayInputStream(mask));
        if (edit == null || area == null) return generated;
        int w = source.getWidth(), h = source.getHeight();
        var out = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            int m = area.getRGB(x * area.getWidth() / w, y * area.getHeight() / h) & 0xff;
            int g = edit.getRGB(x * edit.getWidth() / w, y * edit.getHeight() / h);
            int s = source.getRGB(x, y);
            double a = m / 255.0;
            int r = (int) Math.round(((g >> 16) & 0xff) * a + ((s >> 16) & 0xff) * (1 - a));
            int gr = (int) Math.round(((g >> 8) & 0xff) * a + ((s >> 8) & 0xff) * (1 - a));
            int b = (int) Math.round((g & 0xff) * a + (s & 0xff) * (1 - a));
            out.setRGB(x, y, (r << 16) | (gr << 8) | b);
        }
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(out, "png", bytes);
        return bytes.toByteArray();
    }

    private static String mimeOf(byte[] image) {
        return image.length > 3 && (image[0] & 0xff) == 0x89 && image[1] == 'P' ? "image/png" : "image/jpeg";
    }
}
