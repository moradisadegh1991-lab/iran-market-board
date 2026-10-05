package ir.moradisadegh.marketboard;

/**
 * Text for the built-in Persian voice (EmbeddedTts). The web layer already says numbers in words
 * (lib/voice-io.ts speakable); here only what the voice model cannot read is dropped. Nothing is appended:
 * a trailing full stop (tried against the clipped last syllable of the Piper Persian voices) did not help the
 * chosen voice when measured with Whisper on 24 of the assistant's sentences (CLAUDE.md rule 71); EmbeddedTts
 * plays a breath of silence after the sentence instead.
 */
public final class TtsText {
    private TtsText() {}

    public static String prepare(String text) {
        if (text == null) return "";
        StringBuilder b = new StringBuilder(text.length() + 2);
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isLetterOrDigit(cp) || cp == 0x200C /* ZWNJ */) b.appendCodePoint(cp);
            else if (".,!?؟،؛:;".indexOf(cp) >= 0) b.appendCodePoint(cp);
            else if (cp == '٫') b.append('.');
            else b.append(' '); // emoji, quotes, brackets, symbols: a pause at most
        }
        String s = b.toString().replaceAll("\\s+", " ").trim();
        return s;
    }

    /**
     * One answer → sentences, each made and played in turn (the next is made while the previous plays). A long
     * sentence is also cut at «،» so the first sound comes quickly.
     */
    public static java.util.List<String> sentences(String text) {
        java.util.List<String> out = new java.util.ArrayList<>();
        StringBuilder cur = new StringBuilder();
        String s = prepare(text);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            cur.append(c);
            boolean end = ".!?؟؛".indexOf(c) >= 0 || (c == '،' && cur.length() > 80);
            if (end) {
                String t = cur.toString().trim();
                if (t.replaceAll("[\\p{Punct}\\s،؛؟]", "").length() > 0) out.add(t);
                cur.setLength(0);
            }
        }
        String t = cur.toString().trim();
        if (t.replaceAll("[\\p{Punct}\\s،؛؟]", "").length() > 0) out.add(t);
        return out;
    }
}
