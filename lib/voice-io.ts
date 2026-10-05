// Hearing and speaking Persian for the voice assistant (lib/finance/voice.ts understands the words).
//
// In the APK: the native Voice plugin (android-app/native-plugin/java/VoicePlugin.java) — Android's
// recogniser (Google's when installed), and the phone's text-to-speech when it has a Persian voice.
// Android WebView has no Web Speech API. In a browser: the Web Speech API (Chrome sends the audio to
// Google; Safari and Firefox mostly have none). When neither is there the assistant still works by
// typing or tapping. No text or audio is sent to this app's server from here (CLAUDE.md rule 7).

import { JALALI_MONTHS } from './jalali';
import { numToWords } from './finance/voice';

/** 12 → «دوازدهم», 3 → «سوم», 30 → «سی‌ام» — a day before a month name. */
function ordinal(n: number): string {
  const w = numToWords(n);
  if (n === 1) return 'یکم';
  if (w.endsWith('سه')) return `${w.slice(0, -2)}سوم`;
  if (w.endsWith('سی')) return `${w}\u200cام`;
  return `${w}م`;
}

/**
 * What a voice can read: every number in words (a voice reads «۲۶۸٬۳۰۰» digit by digit, or not at all),
 * «٪» as «درصد», a day before a month name as an ordinal («۱۲ مهر» → «دوازدهم مهر»), and no emoji,
 * arrows or brackets. The assistant's own sentences already say numbers in words; this catches the rest.
 */
export function speakable(text: string): string {
  const month = new RegExp(`^\\s*(${JALALI_MONTHS.join('|')})`);
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/(\d)[٬,](?=\d{3}\b)/g, '$1')
    .replace(/(\d+)[٫.](\d+)/g, (_, a: string, b: string) => `${numToWords(+a)} ممیز ${numToWords(+b)}`)
    .replace(/\d+/g, (d, at: number, all: string) => (month.test(all.slice(at + d.length)) && +d >= 1 && +d <= 31 ? ordinal(+d) : numToWords(+d)))
    .replace(/[٪%]/g, ' درصد')
    .replace(/[‹›«»()[\]{}"—–]/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  /** whose voice speaks: the app's own Persian voice (APK, offline), a phone engine's, or the browser's */
  voice?: 'built-in' | 'phone' | 'browser' | null;
  /** the app's own voice is in this APK but did not start on this phone — why (shown, so it can be reported) */
  voiceError?: string | null;
  /** the app closed unexpectedly last time: what Android recorded (shown once) */
  lastCrash?: AppCrash | null;
  /** try the built-in voice again after it was turned off */
  retryVoice?: () => Promise<void>;
  /** resolves with the recogniser's guesses, best first; rejects with VoiceError */
  listen(onPartial: (text: string) => void, prompt?: string): Promise<string[]>;
  /** use what was heard so far */
  stop(): void;
  cancel(): void;
  /** resolves when said (at once when there is no Persian voice) */
  speak(text: string): Promise<void>;
  hush(): void;
  /** the phone's text-to-speech settings (APK only) — to install or pick a Persian voice */
  openVoiceSettings?: () => void;
}

interface Handle {
  remove(): void | Promise<void>;
}
/** Why the app closed last time (android-app CrashLog): an uncaught Java exception and/or the system's exit record. */
export interface AppCrash {
  at?: number;
  thread?: string;
  stack?: string;
  reason?: 'crash' | 'native-crash' | 'anr' | 'low-memory';
  description?: string;
}

interface VoicePlugin {
  available(): Promise<{
    recognition?: boolean;
    dialog?: boolean;
    mic?: boolean;
    tts?: boolean;
    service?: string | null;
    ttsEngines?: string[];
    ttsEngine?: string | null;
    builtInError?: string | null;
  }>;
  requestMic(): Promise<{ mic?: boolean }>;
  listen(o: { prompt?: string }): Promise<{ matches?: string[] }>;
  listenDialog(o: { prompt?: string }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  speak(o: { text: string }): Promise<void>;
  // absent on an APK built before them
  lastCrash?(): Promise<{ crash?: AppCrash | null }>;
  retryBuiltIn?(): Promise<Awaited<ReturnType<VoicePlugin['available']>>>;
  stopSpeaking(): Promise<void>;
  ttsSettings?(): Promise<void>;
  addListener(event: 'partial' | 'state', fn: (e: { text?: string; state?: string }) => void): Promise<Handle> | Handle;
}

const codeOf = (e: unknown): VoiceErr => {
  const c = (e as { code?: string })?.code;
  return (['permission', 'no-match', 'network', 'language', 'busy', 'unavailable', 'audio', 'cancelled'] as const).find((x) => x === c) ?? 'client';
};

function appIO(p: VoicePlugin, av: Awaited<ReturnType<VoicePlugin['available']>>, lastCrash: AppCrash | null): VoiceIO {
  // the in-app recogniser refused Persian once → Google's voice-typing screen from then on
  let useDialog = !av.recognition && !!av.dialog;
  return {
    kind: 'app',
    lastCrash,
    retryVoice: p.retryBuiltIn
      ? async () => {
          const a = await p.retryBuiltIn!().catch(() => null);
          if (a) Object.assign(av, { tts: a.tts, ttsEngine: a.ttsEngine, builtInError: a.builtInError ?? null });
        }
      : undefined,
    canListen: !!(av.recognition || av.dialog),
    get canSpeak() {
      return !!av.tts;
    },
    get voice() {
      return av.tts ? (av.ttsEngine === 'built-in' ? 'built-in' : 'phone') : null;
    },
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
    get voiceError() {
      return av.builtInError ?? null;
    },
    async speak(text) {
      if (!av.tts) return;
      await p.speak({ text: speakable(text) }).catch(async () => {
        // the built-in voice failed to start (only known once it tried): ask again what can speak, and why not
        const a = await p.available().catch(() => null);
        if (a) Object.assign(av, { tts: a.tts, ttsEngine: a.ttsEngine, builtInError: a.builtInError ?? null });
      });
    },
    hush() {
      void p.stopSpeaking().catch(() => undefined);
    },
    openVoiceSettings: p.ttsSettings
      ? () => {
          void p.ttsSettings!().catch(() => undefined);
          // the plugin looks for a Persian voice again when the app comes back (handleOnResume)
          const back = () => {
            document.removeEventListener('visibilitychange', back);
            setTimeout(() => {
              void p.available().then((a) => {
                av.tts = !!a.tts;
                av.ttsEngine = a.ttsEngine;
              });
            }, 1500);
          };
          document.addEventListener('visibilitychange', back);
        }
      : undefined,
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
    voice: voice ? 'browser' : null,
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
        const u = new SpeechSynthesisUtterance(speakable(text));
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
      const crash = plugin.lastCrash ? ((await plugin.lastCrash().catch(() => null))?.crash ?? null) : null;
      return appIO(plugin, await plugin.available(), crash);
    } catch {
      // an APK built before the plugin existed: fall through to the web path (none in a WebView)
    }
  }
  const w = window as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return webIO(w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null, await persianVoice().catch(() => null));
}

export const VOICE_SPEAK_KEY = 'imf.voice.speak.v1';
