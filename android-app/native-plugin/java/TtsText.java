package ir.moradisadegh.marketboard;

/**
 * Text for the built-in Persian voice (EmbeddedTts). The web layer already says numbers in words
 * (lib/voice-io.ts speakable); here only what the voice model cannot read is dropped, and « ." is
 * appended: the Piper Persian voices cut the last syllable short, and measured with Whisper on the
 * assistant's own sentences a trailing full stop kept the last word in all of them (CLAUDE.md rule 71).
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
        return s.isEmpty() ? "" : s + " .";
    }
}
