package com.obracota.infrastructure.knowledge;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;

final class PdfText {
    private static final Set<String> ACTIVE = Set.of("JS", "JavaScript", "EmbeddedFiles", "EF", "XFA", "RichMediaContent");
    record Page(int number, String text, String section, boolean ocr) {}

    static final class Rejected extends IOException {
        Rejected(String code) { super(code); }
    }

    static List<Page> read(Path file, Path scannerDb, boolean scanRequired) throws IOException, InterruptedException {
        if (scannerDb != null) {
            int status = command(Duration.ofSeconds(45), "clamscan", "--database=" + scannerDb, "--no-summary", file.toString());
            if (status != 0) throw new Rejected(status == 1 ? "MALWARE" : "SCANNER_UNAVAILABLE");
        } else if (scanRequired) throw new Rejected("SCANNER_UNAVAILABLE");

        var deadline = System.nanoTime() + Duration.ofMinutes(4).toNanos();
        try (var pdf = Loader.loadPDF(file.toFile())) {
            int count = pdf.getNumberOfPages();
            if (pdf.isEncrypted() || count < 1 || count > 100) throw new Rejected("INVALID_PDF");
            checkActive(pdf.getDocumentCatalog().getCOSObject());
            var sections = new TreeMap<Integer, String>();
            var outline = pdf.getDocumentCatalog().getDocumentOutline();
            if (outline != null) {
                var todo = new ArrayDeque<org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem>();
                outline.children().forEach(todo::add);
                for (int n = 0; !todo.isEmpty() && n < 300; n++) {
                    var item = todo.removeFirst();
                    var page = item.findDestinationPage(pdf);
                    if (page != null && item.getTitle() != null) {
                        String title = clean(item.getTitle());
                        if (!title.isBlank()) sections.put(pdf.getPages().indexOf(page) + 1, title.substring(0, Math.min(title.length(), 255)));
                    }
                    if (item.hasChildren()) item.children().forEach(todo::add);
                }
            }
            var stripper = new PDFTextStripper();
            var renderer = new PDFRenderer(pdf);
            renderer.setSubsamplingAllowed(true);
            var result = new ArrayList<Page>();
            int characters = 0;
            for (int page = 1; page <= count; page++) {
                if (System.nanoTime() > deadline) throw new Rejected("PROCESSING_TIMEOUT");
                stripper.setStartPage(page);
                stripper.setEndPage(page);
                String text = clean(stripper.getText(pdf));
                boolean usedOcr = false;
                if (text.isBlank()) {
                    text = ocr(renderer, file.getParent(), page - 1, pdf.getPage(page - 1).getCropBox());
                    usedOcr = !text.isBlank();
                }
                characters += text.length();
                if (characters > 200_000) throw new Rejected("TOO_MUCH_TEXT");
                if (!text.isBlank()) {
                    var section = sections.floorEntry(page);
                    result.add(new Page(page, text, section == null ? null : section.getValue(), usedOcr));
                }
            }
            return result;
        }
    }

    private static String clean(String text) {
        return text.replaceAll("[\\p{Cntrl}\\s]+", " ").strip();
    }

    private static void checkActive(COSBase root) throws Rejected {
        var seen = Collections.newSetFromMap(new IdentityHashMap<COSBase, Boolean>());
        var nodes = new ArrayDeque<COSBase>();
        nodes.add(root);
        while (!nodes.isEmpty()) {
            var value = nodes.removeLast();
            if (!seen.add(value)) continue;
            if (seen.size() > 100_000) throw new Rejected("COMPLEX_PDF");
            if (value instanceof COSObject reference) {
                if (reference.getObject() != null) nodes.add(reference.getObject());
            } else if (value instanceof COSDictionary dictionary) {
                if ("Launch".equals(dictionary.getNameAsString(COSName.S))) throw new Rejected("ACTIVE_PDF");
                for (var key : dictionary.keySet()) {
                    if (ACTIVE.contains(key.getName())) throw new Rejected("ACTIVE_PDF");
                    if (dictionary.getItem(key) != null) nodes.add(dictionary.getItem(key));
                }
            } else if (value instanceof COSArray array) {
                for (var entry : array) if (entry != null) nodes.add(entry);
            }
        }
    }

    private static String ocr(PDFRenderer renderer, Path directory, int page,
                              org.apache.pdfbox.pdmodel.common.PDRectangle size) throws IOException, InterruptedException {
        double area = (double) size.getWidth() * size.getHeight();
        if (!Double.isFinite(area) || area <= 0) throw new Rejected("INVALID_PDF");
        var input = Files.createTempFile(directory, "ocr-", ".png");
        Path output = Path.of(input + ".txt");
        try {
            float scale = (float) Math.min(2.5, Math.sqrt(5_000_000 / area));
            var image = renderer.renderImage(page, scale);
            try { ImageIO.write(image, "png", input.toFile()); } finally { image.flush(); }
            if (command(Duration.ofSeconds(30), "tesseract", input.toString(), input.toString(),
                "-l", "spa+eng", "--psm", "3") != 0) throw new Rejected("OCR_UNAVAILABLE");
            if (Files.size(output) > 800_000) throw new Rejected("TOO_MUCH_TEXT");
            return clean(Files.readString(output));
        } finally {
            Files.deleteIfExists(output);
            Files.deleteIfExists(input);
        }
    }

    private static int command(Duration timeout, String... arguments) throws IOException, InterruptedException {
        var process = new ProcessBuilder(arguments).redirectOutput(ProcessBuilder.Redirect.DISCARD)
            .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            if (!process.waitFor(timeout.toSeconds(), TimeUnit.SECONDS)) throw new Rejected("PROCESSING_TIMEOUT");
            return process.exitValue();
        } finally {
            if (process.isAlive()) process.destroyForcibly();
        }
    }
}
