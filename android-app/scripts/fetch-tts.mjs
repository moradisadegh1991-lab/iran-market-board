#!/usr/bin/env node
/**
 * Fetches the app's built-in Persian voice (CLAUDE.md rule 71) into android-app/tts/ (git-ignored):
 *   tts/sherpa-onnx.aar         sherpa-onnx (onnxruntime linked in) — the engine, Apache-2.0
 *   tts/voice/model.onnx        Piper fa_IR «ganji_adabi» medium, int8 — CC0
 *   tts/voice/tokens.txt
 *   tts/voice/espeak-ng-data/   only what Persian needs (1.1 MB of the 19 MB): the phoneme tables and fa/en
 *                               dictionaries; scripts/tts-smoke.py proves the output is identical
 * Both downloads are pinned by SHA-256, so a changed file on the release page fails the build instead of
 * shipping something else. Idempotent: skips what is already there. wire-native-plugin.mjs puts it in the
 * Android project. Run: node scripts/fetch-tts.mjs
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // android-app/
const OUT = join(ROOT, 'tts');
export const TTS = {
  version: 'ganji_adabi-int8-1.13.8',
  aar: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-static-link-onnxruntime-1.13.8.aar',
    sha256: 'b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471',
  },
  voice: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fa_IR-ganji_adabi-medium-int8.tar.bz2',
    sha256: '42cc4a913e9e5a703a5a5d758267dd38ae6d86b47d4defad1e826be7885b050c',
    dir: 'vits-piper-fa_IR-ganji_adabi-medium-int8',
    onnx: 'fa_IR-ganji_adabi-medium.onnx',
  },
  // what Persian needs from espeak-ng-data (English for the odd Latin word: BTC, DXY)
  espeak: ['phondata', 'phonindex', 'phontab', 'intonations', 'fa_dict', 'en_dict', 'lang/ira/fa', 'lang/gmw/en'],
};

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

async function download(url, to, want) {
  if (existsSync(to) && sha(to) === want) return console.log(`✓ ${to.replace(ROOT + '/', '')} (cached)`);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(to, Buffer.from(await r.arrayBuffer()));
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(`download failed: ${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 2000 * 2 ** (attempt - 1)));
    }
  }
  const got = sha(to);
  if (got !== want) {
    rmSync(to);
    throw new Error(`checksum mismatch for ${url}\n  want ${want}\n  got  ${got}`);
  }
  console.log(`✓ ${to.replace(ROOT + '/', '')} (sha256 ok)`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const stamp = join(OUT, 'VERSION');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === TTS.version && existsSync(join(OUT, 'voice/model.onnx'))) {
    console.log(`✓ built-in Persian voice ${TTS.version} already in android-app/tts/`);
    return;
  }
  const dl = join(OUT, 'dl');
  mkdirSync(dl, { recursive: true });
  await download(TTS.aar.url, join(OUT, 'sherpa-onnx.aar'), TTS.aar.sha256);
  const tar = join(dl, 'voice.tar.bz2');
  await download(TTS.voice.url, tar, TTS.voice.sha256);
  execFileSync('tar', ['xjf', tar, '-C', dl]);
  const src = join(dl, TTS.voice.dir);
  const voice = join(OUT, 'voice');
  rmSync(voice, { recursive: true, force: true });
  mkdirSync(join(voice, 'espeak-ng-data'), { recursive: true });
  cpSync(join(src, TTS.voice.onnx), join(voice, 'model.onnx'));
  cpSync(join(src, 'tokens.txt'), join(voice, 'tokens.txt'));
  for (const f of TTS.espeak) {
    mkdirSync(dirname(join(voice, 'espeak-ng-data', f)), { recursive: true });
    cpSync(join(src, 'espeak-ng-data', f), join(voice, 'espeak-ng-data', f), { recursive: true });
  }
  rmSync(join(dl, TTS.voice.dir), { recursive: true, force: true });
  writeFileSync(stamp, TTS.version + '\n');
  console.log(`✓ built-in Persian voice ${TTS.version} → android-app/tts/`);
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
