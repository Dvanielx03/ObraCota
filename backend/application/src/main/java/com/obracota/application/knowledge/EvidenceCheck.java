package com.obracota.application.knowledge;

import com.obracota.application.knowledge.port.SpecificationPassages.Passage;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks that keep a model's reply honest against the indexed text of a specification. The PDF text is data: sentences
 * shaped as instructions to an assistant are left out before generation. A reply is published only when its quote is
 * verbatim in the indexed passage, every number of the answer is in the quote (with the same unit when the quote gives
 * one) and the evidence shares terms with the question; a quoted measurement also needs its label to name what was asked.
 */
public final class EvidenceCheck {
    /** Replaces an instruction-shaped sentence in the text sent to the model; it is never in the indexed text. */
    public static final String OMITTED = "[texto omitido]";
    private static final Pattern SENTENCE = Pattern.compile("[^.!?;]+[.!?;]*");
    private static final List<Pattern> INSTRUCTIONS = List.of(
        Pattern.compile("\\b(ignor|olvid|disregard|forget)\\w*(\\s+\\S+){0,4}?\\s+(instrucc|indicacion|orden|regla|prompt|instruction|rule|anterior|previous|above)"),
        Pattern.compile("\\b(responde|contesta|respondan|di|digan|escribe|answer|reply|respond|say|write)\\s+(siempre\\s+|always\\s+|solo\\s+|only\\s+)?(que|that)\\b"),
        Pattern.compile("\\b(actua|actuar|act|behave)\\s+(como|as)\\b|\\b(ahora eres|now you are|eres un asistente|you are an? (assistant|ai|model))\\b"),
        Pattern.compile("\\b(system prompt|prompt del sistema|instrucciones del sistema|nuevas instrucciones|new instructions|developer message|mensaje del sistema)\\b"),
        Pattern.compile("\\b(asistente|assistant|modelo de lenguaje|language model|chatbot|ia|ai)\\b[^.]{0,60}\\b(debe|deberas|tienes que|must|should|shall)\\b"));
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]{4,}");
    /** Codes such as «B», «MCB» or «P90», and proper names inside the question such as «Arlington». */
    private static final Pattern CODE = Pattern.compile("(?<![\\p{L}\\p{N}])(?:[A-Z][A-Z0-9]{0,5}|[A-Z][a-z]{3,})(?![\\p{L}\\p{N}])");
    private static final Pattern NUMBER = Pattern.compile("(?<![\\p{L}\\p{N}])\\d+(?:[.,]\\d+)*");
    private static final Pattern PAGE = Pattern.compile("(?iu)\\b(?:p[aá]g(?:ina|\\.)?|page|p\\.)\\s*\\d+");
    private static final String UNITS = "w/\\(m²·k\\)|w/m²k|w/m2k|w/mk|n/mm²|n/mm2|kgf/cm²|kg/cm2|kg/cm²|kg/m³|kg/m3|kg/m²|kg/m2|"
        + "mpa|kpa|gpa|psi|pa|kn|kw|db|°c|ºc|m²|m2|m³|m3|mm|cm|km|ml|kg|lb|ft|in|pulgadas|pulgada|pies|horas|hora|hrs|hr|"
        + "minutos|min|segundos|seg|dias|días|años|anos|meses|%|°|m|g|t|l|h|s|n|w|v";
    private static final Pattern MEASURE = Pattern.compile("(?iu)(?<![\\p{L}\\p{N}])(\\d+(?:[.,]\\d+)*)\\s?(" + UNITS + ")(?![\\p{L}\\p{N}²³])");
    private static final Set<String> COMMON = Set.of("cual", "cuales", "cuanto", "cuanta", "cuantos", "como", "donde", "cuando",
        "sobre", "segun", "tiene", "tienen", "dice", "indica", "indican", "cita", "citar", "exacta", "exactas", "exacto", "palabras",
        "contenido", "apartado", "literal", "literalmente", "ficha", "fichas", "tecnica", "documento", "documentos", "dato", "datos",
        "valor", "valores", "pieza", "elemento", "esta", "este", "estos", "estas", "para", "desde", "hasta", "entre", "pagina",
        "muro", "pared", "puerta", "losa", "producto", "material", "lleva", "debe", "puede", "queda", "seccion",
        "what", "which", "does", "with", "from", "this", "that", "page");
    private static final Set<String> NOT_NAMES = Set.of("Cual", "Cuál", "Cuales", "Cuáles", "Cuanto", "Cuánto", "Cuanta", "Cuánta",
        "Como", "Cómo", "Donde", "Dónde", "Cuando", "Cuándo", "Segun", "Según", "Para", "Esta", "Este", "Dime", "Indica", "What", "Which");

    private EvidenceCheck() {}

    /** A measurement as written ("28 MPa") and its comparable form (28.0 mpa); positions are within the text read. */
    public record Measure(String text, double value, String unit, int start, int end) {
        public boolean sameAs(Measure other) { return Double.compare(value, other.value) == 0 && unit.equals(other.unit); }
    }

    /** A passage without its instruction-shaped sentences, and how many were left out. */
    public record Clean(Passage passage, int omitted) {}

    /** What a question asks about: content words (first five letters), numbers and codes or proper names. */
    public record Terms(Set<String> words, Set<String> codes) {
        public boolean isEmpty() { return words.isEmpty() && codes.isEmpty(); }
    }

    public static String normalize(String text) {
        return Normalizer.normalize(text.toLowerCase(Locale.ROOT), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    }

    public static boolean instruction(String sentence) {
        String plain = normalize(sentence);
        return INSTRUCTIONS.stream().anyMatch(pattern -> pattern.matcher(plain).find());
    }

    /** The passage as data for the model: instruction-shaped sentences become {@link #OMITTED}. */
    public static Clean clean(Passage passage) {
        var out = new StringBuilder();
        int omitted = 0;
        Matcher sentences = SENTENCE.matcher(passage.content());
        int last = 0;
        while (sentences.find()) {
            out.append(passage.content(), last, sentences.start());
            if (instruction(sentences.group())) {
                out.append(OMITTED).append(' ');
                omitted++;
            } else out.append(sentences.group());
            last = sentences.end();
        }
        out.append(passage.content().substring(last));
        return new Clean(new Passage(passage.page(), passage.offset(), out.toString(), passage.section()), omitted);
    }

    /** Numbers of the text (decimal comma or point), without page references. */
    public static List<Double> numbers(String text) {
        var result = new ArrayList<Double>();
        Matcher matcher = NUMBER.matcher(PAGE.matcher(text).replaceAll(" "));
        while (matcher.find()) {
            Double value = parse(matcher.group());
            if (value != null) result.add(value);
        }
        return result;
    }

    private static Double parse(String raw) {
        String text = raw;
        // "1.250,5" and "1,250.5": the last separator is the decimal one when both appear.
        if (text.contains(",") && text.contains(".")) {
            boolean comma = text.lastIndexOf(',') > text.lastIndexOf('.');
            text = comma ? text.replace(".", "").replace(',', '.') : text.replace(",", "");
        } else text = text.replace(',', '.');
        if (text.chars().filter(c -> c == '.').count() > 1) text = text.replace(".", "");
        try { return Double.parseDouble(text); } catch (NumberFormatException e) { return null; }
    }

    public static List<Measure> measures(String text) {
        var result = new ArrayList<Measure>();
        Matcher matcher = MEASURE.matcher(text);
        while (matcher.find()) {
            Double value = parse(matcher.group(1));
            if (value == null) continue;
            String unit = normalize(matcher.group(2)).replace("º", "°").replace("2", "²").replace("3", "³");
            result.add(new Measure(matcher.group().strip(), value, unit, matcher.start(), matcher.end()));
        }
        return result;
    }

    public static Terms terms(String question) {
        String text = PAGE.matcher(question).replaceAll(" ");
        var words = new LinkedHashSet<String>();
        WORD.matcher(normalize(text)).results().map(m -> m.group())
            .filter(word -> !COMMON.contains(word) && !word.chars().allMatch(Character::isDigit))
            .forEach(word -> words.add(word.length() > 5 ? word.substring(0, 5) : word));
        numbers(text).forEach(n -> words.add("#" + n));
        var codes = new LinkedHashSet<String>();
        CODE.matcher(text).results().map(m -> m.group()).filter(code -> !NOT_NAMES.contains(code)).forEach(codes::add);
        return new Terms(words, codes);
    }

    private static boolean word(String plain, List<Double> numbers, String term) {
        if (term.startsWith("#")) return numbers.contains(Double.parseDouble(term.substring(1)));
        return Pattern.compile("(?<![\\p{L}\\p{N}])" + Pattern.quote(term)).matcher(plain).find();
    }

    private static boolean code(String text, String code) {
        return Pattern.compile("(?<![\\p{L}\\p{N}])" + Pattern.quote(code) + "(?![\\p{L}\\p{N}])",
            code.chars().allMatch(c -> Character.isUpperCase(c) || Character.isDigit(c)) ? 0 : Pattern.CASE_INSENSITIVE).matcher(text).find();
    }

    /** Whether the text holds at least one of the question terms. */
    public static boolean mentions(String text, Terms terms) {
        String plain = normalize(text);
        var numbers = numbers(text);
        return terms.codes().stream().anyMatch(c -> code(text, c)) || terms.words().stream().anyMatch(w -> word(plain, numbers, w));
    }

    /** Whether the text names what the question asks: a shared code, or at least half of its words. */
    public static boolean names(String text, Terms terms) {
        if (terms.codes().stream().anyMatch(c -> code(text, c))) return true;
        if (terms.words().isEmpty()) return false;
        String plain = normalize(text);
        var numbers = numbers(text);
        long shared = terms.words().stream().filter(w -> word(plain, numbers, w)).count();
        return shared >= Math.max(1, (terms.words().size() + 1) / 2);
    }

    /**
     * Where the model's quote is in {@code text}, ignoring case, accents and runs of white space (a small model often
     * lowercases a quote). The caller publishes {@code text}'s own span, so the citation stays verbatim.
     */
    public static Optional<int[]> locate(String text, String quote) {
        var plain = new StringBuilder();
        var origin = new ArrayList<Integer>();
        boolean space = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isWhitespace(c)) {
                if (!space && plain.length() > 0) { plain.append(' '); origin.add(i); }
                space = true;
                continue;
            }
            space = false;
            String folded = normalize(String.valueOf(c));
            for (int k = 0; k < folded.length(); k++) { plain.append(folded.charAt(k)); origin.add(i); }
        }
        String wanted = normalize(quote).replaceAll("\\s+", " ").strip();
        if (wanted.length() < 4) return Optional.empty();
        int at = plain.indexOf(wanted);
        if (at < 0) return Optional.empty();
        return Optional.of(new int[]{origin.get(at), origin.get(at + wanted.length() - 1) + 1});
    }

    /**
     * The sentence that holds the span [start, end) of {@code text}, at most 160 characters on each side, so a quote
     * such as «290 mm» is published with the label that says what it measures.
     */
    public static int[] sentence(String text, int start, int end) {
        int from = Math.max(0, start - 160), to = Math.min(text.length(), end + 160);
        for (int i = start - 1; i >= from; i--) if (boundary(text, i)) { from = i + 1; break; }
        for (int i = Math.max(end - 1, start); i < to; i++) if (boundary(text, i)) { to = i + 1; break; }
        while (from < start && Character.isWhitespace(text.charAt(from))) from++;
        while (to > end && Character.isWhitespace(text.charAt(to - 1))) to--;
        return new int[]{from, to};
    }

    private static boolean boundary(String text, int i) {
        char c = text.charAt(i);
        if (c == ';' || c == '!' || c == '?') return true;
        if (c != '.') return false;
        boolean decimal = i > 0 && i + 1 < text.length() && Character.isDigit(text.charAt(i - 1)) && Character.isDigit(text.charAt(i + 1));
        return !decimal;
    }

    /** The text around a span of its passage: the label before a value usually names what is measured. */
    public static String window(String passage, int start, int end) {
        return passage.substring(Math.max(0, start - 120), Math.min(passage.length(), end + 40));
    }

    /** The label written before position {@code at} in the same sentence (up to 120 characters). */
    public static String label(String passage, int at) {
        int from = Math.max(0, at - 120);
        for (int i = at - 1; i >= from; i--) {
            char c = passage.charAt(i);
            boolean decimal = c == '.' && i > 0 && i + 1 < passage.length() && Character.isDigit(passage.charAt(i - 1)) && Character.isDigit(passage.charAt(i + 1));
            if ((c == '.' && !decimal) || c == ';' || c == '!' || c == '?') { from = i + 1; break; }
        }
        return passage.substring(from, at);
    }

    /**
     * The measurement the answer states and the quote supports, when the answer passes the checks: every number of the
     * answer is in the quote, and a value the quote gives with a unit keeps that unit in the answer.
     */
    public static Optional<Optional<Measure>> supports(String answer, String quote) {
        var said = numbers(answer);
        if (!numbers(quote).containsAll(said)) return Optional.empty();
        var quotedMeasures = measures(quote);
        for (var measure : measures(PAGE.matcher(answer).replaceAll(" "))) {
            var same = quotedMeasures.stream().filter(q -> Double.compare(q.value(), measure.value()) == 0).toList();
            if (!same.isEmpty() && same.stream().noneMatch(measure::sameAs)) return Optional.empty();
        }
        var datum = quotedMeasures.stream().filter(m -> said.contains(m.value())).findFirst();
        if (datum.isEmpty() && said.isEmpty() && quotedMeasures.size() == 1) datum = Optional.of(quotedMeasures.getFirst());
        return Optional.of(datum);
    }
}
