// Hearing and speaking Persian for the voice assistant (lib/finance/voice.ts understands the words).
//
// In the APK: the native Voice plugin (android-app/native-plugin/java/VoicePlugin.java) — Android's
// recogniser (Google's when installed), and the phone's text-to-speech when it has a Persian voice.
// Android WebView has no Web Speech API. In a browser: the Web Speech API (Chrome sends the audio to
// Google; Safari and Firefox mostly have none). When neither is there the assistant still works by
// typing or tapping. No text or audio is sent to this app's server from here (CLAUDE.md rule 7).

export type VoiceErr = 'permission' | 'no-match' | 'network' | 'language' | 'busy' | 'unavailable' | 'audio' | 'cancelled' | 'client';
export class VoiceError extends Error {
  constructor(public code: VoiceErr) {
    super(code);
  }
}

export interface VoiceIO {
  kind: 'app' | 'web' | 'none';
  canListen: boolean;
  canSpeak: boolean;
  /** resolves with the recogniser's guesses, best first; rejects with VoiceError */
  listen(onPartial: (text: string) => void, prompt?: string): Promise<string[]>;
  /** use what was heard so far */
  stop(): void;
  cancel(): void;
  /** resolves when said (at once when there is no Persian voice) */
  speak(text: string): Promise<void>;
  hush(): void;
}

interface Handle {
  remove(): void | Promise<void>;
}
interface VoicePlugin {
  available(): Promise<{ recognition?: boolean; dialog?: boolean; mic?: boolean; tts?: boolean; service?: string | null }>;
  requestMic(): Promise<{ mic?: boolean }>;
  listen(o: { prompt?: string }): Promise<{ matches?: string[] }>;
  listenDialog(o: { prompt?: string }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  speak(o: { text: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  addListener(event: 'partial' | 'state', fn: (e: { text?: string; state?: string }) => void): Promise<Handle> | Handle;
}

const codeOf = (e: unknown): VoiceErr => {
  const c = (e as { code?: string })?.code;
  return (['permission', 'no-match', 'network', 'language', 'busy', 'unavailable', 'audio', 'cancelled'] as const).find((x) => x === c) ?? 'client';
};

function appIO(p: VoicePlugin, av: Awaited<ReturnType<VoicePlugin['available']>>): VoiceIO {
  // the in-app recogniser refused Persian once → Google's voice-typing screen from then on
  let useDialog = !av.recognition && !!av.dialog;
  return {
    kind: 'app',
    canListen: !!(av.recognition || av.dialog),
    canSpeak: !!av.tts,
    async listen(onPartial, prompt) {
      const mic = av.mic || (await p.requestMic().catch(() => ({ mic: false }))).mic;
      if (!mic) throw new VoiceError('permission');
      av.mic = true;
      const sub = await p.addListener('partial', (e) => {
        if (e.text) onPartial(e.text);
      });
      try {
        const once = async (dialog: boolean) => (dialog ? p.listenDialog({ prompt }) : p.listen({ prompt }));
        let r;
        try {
          r = await once(useDialog);
        } catch (e) {
          const code = codeOf(e);
          if (useDialog || !av.dialog || (code !== 'language' && code !== 'unavailable')) throw e;
          useDialog = true;
          r = await once(true);
        }
        const m = (r.matches ?? []).filter(Boolean);
        if (!m.length) throw new VoiceError('no-match');
        return m;
      } catch (e) {
        throw e instanceof VoiceError ? e : new VoiceError(codeOf(e));
      } finally {
        void sub.remove();
      }
    },
    stop() {
      void p.stop().catch(() => undefined);
    },
    cancel() {
      void p.cancel().catch(() => undefined);
    },
    async speak(text) {
      if (!av.tts) return;
      await p.speak({ text }).catch(() => undefined);
    },
    hush() {
      void p.stopSpeaking().catch(() => undefined);
    },
  };
}

interface SR {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function persianVoice(): Promise<SpeechSynthesisVoice | null> {
  const ss = window.speechSynthesis;
  if (!ss) return Promise.resolve(null);
  const pick = () => ss.getVoices().find((v) => /^fa(\b|-|_)/i.test(v.lang)) ?? null;
  const now = pick();
  if (now || ss.getVoices().length) return Promise.resolve(now);
  // Chrome fills the list a moment later
  return new Promise((res) => {
    const t = setTimeout(() => res(pick()), 800);
    ss.addEventListener?.('voiceschanged', () => {
      clearTimeout(t);
      res(pick());
    });
  });
}

function webIO(Rec: (new () => SR) | null, voice: SpeechSynthesisVoice | null): VoiceIO {
  let rec: SR | null = null;
  return {
    kind: Rec ? 'web' : 'none',
    canListen: !!Rec,
    canSpeak: !!voice,
    listen(onPartial) {
      return new Promise<string[]>((resolve, reject) => {
        if (!Rec) return reject(new VoiceError('unavailable'));
        rec?.abort();
        const r = new Rec();
        rec = r;
        r.lang = 'fa-IR';
        r.interimResults = true;
        r.maxAlternatives = 5;
        r.continuous = false;
        let done = false;
        r.onresult = (e) => {
          const last = e.results[e.results.length - 1];
          if (!last) return;
          if (!last.isFinal) return onPartial(last[0]?.transcript ?? '');
          const alts = Array.from({ length: last.length }, (_, i) => last[i].transcript).filter((x) => x && x.trim());
          done = true;
          if (alts.length) resolve(alts);
          else reject(new VoiceError('no-match'));
        };
        r.onerror = (e) => {
          done = true;
          const map: Record<string, VoiceErr> = {
            'no-speech': 'no-match',
            'not-allowed': 'permission',
            'service-not-allowed': 'permission',
            network: 'network',
            'language-not-supported': 'language',
            aborted: 'cancelled',
            'audio-capture': 'audio',
          };
          reject(new VoiceError(map[e.error] ?? 'client'));
        };
        r.onend = () => {
          if (!done) reject(new VoiceError('no-match'));
          if (rec === r) rec = null;
        };
        try {
          r.start();
        } catch {
          reject(new VoiceError('busy'));
        }
      });
    },
    stop() {
      rec?.stop();
    },
    cancel() {
      rec?.abort();
    },
    speak(text) {
      if (!voice) return Promise.resolve();
      return new Promise<void>((res) => {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.onend = () => res();
        u.onerror = () => res();
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      });
    },
    hush() {
      window.speechSynthesis?.cancel();
    },
  };
}

/** What this device can do. Call after mount (the Capacitor bridge does not exist during the static render). */
export async function voiceIO(): Promise<VoiceIO> {
  const plugin = (window as { Capacitor?: { Plugins?: { Voice?: VoicePlugin } } }).Capacitor?.Plugins?.Voice;
  if (plugin && typeof plugin.available === 'function') {
    try {
      return appIO(plugin, await plugin.available());
    } catch {
      // an APK built before the plugin existed: fall through to the web path (none in a WebView)
    }
  }
  const w = window as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return webIO(w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null, await persianVoice().catch(() => null));
}

export const VOICE_SPEAK_KEY = 'imf.voice.speak.v1';
