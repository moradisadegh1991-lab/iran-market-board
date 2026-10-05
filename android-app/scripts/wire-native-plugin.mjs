#!/usr/bin/env node
/**
 * Wires the SMS-reader plugin into the Capacitor Android project — automatically, instead of
 * the three hand-edits the README used to ask for (copy a Java file into a package-specific
 * path, patch MainActivity.java, patch AndroidManifest.xml). Hand-editing Java is exactly
 * where "توضیحات نصب" silently goes stale or gets one line wrong; this makes it a build step.
 *
 * Run after `npx cap add android` / `npx cap sync android`, or via `npm run wire-plugin`.
 * Idempotent: safe to run on every build, in CI or locally, before or after MainActivity.java
 * already has an onCreate().
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // android-app/
const cfg = JSON.parse(readFileSync(join(ROOT, 'capacitor.config.json'), 'utf8'));
const appId = cfg.appId;
if (!appId) fail('capacitor.config.json has no appId');

const pkgPath = appId.split('.').join('/');
const javaDir = join(ROOT, 'android/app/src/main/java', pkgPath);
const mainActivityPath = join(javaDir, 'MainActivity.java');
const manifestPath = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const nativeDir = join(ROOT, 'native-plugin/java');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}
function warnMissing(path, hint) {
  console.warn(`⚠ ${path} not found yet — ${hint}`);
}

if (!existsSync(join(ROOT, 'android'))) {
  warnMissing('android/', 'run `npx cap add android` first, then re-run this script.');
  process.exit(0); // not an error: this is expected before the platform exists yet
}

// ── 1. copy the plugin and its classes (BankSms, SmsAsk, the two receivers), package matched to appId ──
mkdirSync(javaDir, { recursive: true });
for (const file of readdirSync(nativeDir).filter((f) => f.endsWith('.java')).sort()) {
  const java = readFileSync(join(nativeDir, file), 'utf8').replace(/^package [\w.]+;/m, `package ${appId};`);
  writeFileSync(join(javaDir, file), java);
  console.log(`✓ ${file} → ${join(javaDir, file).replace(ROOT + '/', '')}`);
}

// ── 2. register the plugins in MainActivity.java (SmsReader; Voice — the voice assistant) ──
const PLUGINS = ['SmsReaderPlugin', 'VoicePlugin'];
if (!existsSync(mainActivityPath)) {
  warnMissing(mainActivityPath, 'expected after `cap add android`; run that first.');
} else {
  let ma = readFileSync(mainActivityPath, 'utf8');
  for (const plugin of PLUGINS) {
    if (ma.includes(`registerPlugin(${plugin}.class)`)) {
      console.log(`✓ MainActivity.java already registers ${plugin} (no change)`);
      continue;
    }
    if (!ma.includes(`import ${appId}.${plugin};`)) {
      ma = ma.replace(/(import com\.getcapacitor\.BridgeActivity;)/, `$1\nimport ${appId}.${plugin};`);
    }
    const hasOnCreate = /void\s+onCreate\s*\(/.test(ma);
    if (hasOnCreate) {
      // insert the registerPlugin call as the first line of the existing onCreate body
      ma = ma.replace(/(void\s+onCreate\s*\([^)]*\)\s*\{)/, `$1\n        registerPlugin(${plugin}.class);`);
    } else {
      // Capacitor 6's generated MainActivity has no onCreate override at all — add one
      // handles both "{}" (empty body on one line) and "{\n}" (empty body on two lines)
      ma = ma.replace(
        /public class MainActivity extends BridgeActivity\s*\{\s*\}/,
        `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(${plugin}.class);\n        super.onCreate(savedInstanceState);\n    }\n}`,
      );
    }
    console.log(`✓ MainActivity.java now registers ${plugin} (onCreate ${hasOnCreate ? 'extended' : 'added'})`);
  }
  writeFileSync(mainActivityPath, ma);
}

// ── 3. permissions ──
if (!existsSync(manifestPath)) {
  warnMissing(manifestPath, 'expected after `cap add android`; run that first.');
} else {
  let mf = readFileSync(manifestPath, 'utf8');
  // POST_NOTIFICATIONS is required from Android 13 (API 33); without it the local
  // notification is silently dropped and nothing tells you why.
  // RECEIVE_SMS: the «نوعش چیست؟» notification the moment a bank SMS arrives (SmsAskReceiver)
  // RECORD_AUDIO: the voice assistant (VoicePlugin), asked for the first time the mic is tapped
  const perms = ['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS', 'android.permission.POST_NOTIFICATIONS', 'android.permission.RECORD_AUDIO'];
  let changed = false;
  for (const perm of perms) {
    if (mf.includes(perm)) {
      console.log(`✓ AndroidManifest.xml already has ${perm.split('.').pop()} (no change)`);
      continue;
    }
    mf = mf.replace(/(<manifest[^>]*>)/, `$1\n    <uses-permission android:name="${perm}" />`);
    changed = true;
    console.log(`✓ AndroidManifest.xml: ${perm.split('.').pop()} permission added`);
  }
  // the receivers: SMS_RECEIVED only from the system (BROADCAST_SMS), the button taps only from
  // this app's own notifications (not exported)
  const receivers = [
    ['SmsAskReceiver', `<receiver android:name=".SmsAskReceiver" android:exported="true" android:permission="android.permission.BROADCAST_SMS">\n            <intent-filter>\n                <action android:name="android.provider.Telephony.SMS_RECEIVED" />\n            </intent-filter>\n        </receiver>`],
    ['SmsChoiceReceiver', `<receiver android:name=".SmsChoiceReceiver" android:exported="false" />`],
  ];
  for (const [name, xml] of receivers) {
    if (mf.includes(`android:name=".${name}"`)) {
      console.log(`✓ AndroidManifest.xml already declares ${name} (no change)`);
      continue;
    }
    if (!/<\/application>/.test(mf)) fail('AndroidManifest.xml has no </application> to add the receivers to');
    mf = mf.replace(/(\s*)<\/application>/, `\n        ${xml}$1</application>`);
    changed = true;
    console.log(`✓ AndroidManifest.xml: ${name} declared`);
  }
  // Android 11+ hides other apps' services unless declared: without this the speech recogniser and the
  // text-to-speech engines are invisible to VoicePlugin and the assistant says there is no recogniser
  if (mf.includes('android.speech.RecognitionService')) console.log('✓ AndroidManifest.xml already declares the speech <queries> (no change)');
  else {
    const queries = `<queries>\n        <intent><action android:name="android.speech.RecognitionService" /></intent>\n        <intent><action android:name="android.speech.action.RECOGNIZE_SPEECH" /></intent>\n        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>\n    </queries>`;
    mf = mf.replace(/(\s*)<application/, `\n    ${queries}$1<application`);
    changed = true;
    console.log('✓ AndroidManifest.xml: speech <queries> declared');
  }
  // the assistant from anywhere (rule 74): the phone's assist gesture and a headset's voice button open MainActivity
  // (an app with an ACTION_ASSIST activity can be chosen as the «digital assistant app»), the icon shortcut, the tile
  if (mf.includes('android.intent.action.ASSIST')) console.log('✓ AndroidManifest.xml already opens the assistant from the assist gesture (no change)');
  else {
    const filters = `<intent-filter>\n                <action android:name="android.intent.action.ASSIST" />\n                <category android:name="android.intent.category.DEFAULT" />\n            </intent-filter>\n            <intent-filter>\n                <action android:name="android.intent.action.VOICE_COMMAND" />\n                <category android:name="android.intent.category.DEFAULT" />\n            </intent-filter>\n            <meta-data android:name="android.app.shortcuts" android:resource="@xml/assist_shortcuts" />`;
    const selfClosing = /<activity([^>]*android:name="[^"]*MainActivity"[^>]*?)\s*\/>/;
    const main = /(<activity[^>]*android:name="[^"]*MainActivity"[^>]*[^/]>[\s\S]*?)(\s*<\/activity>)/;
    if (selfClosing.test(mf)) mf = mf.replace(selfClosing, `<activity$1>\n            ${filters}\n        </activity>`);
    else if (main.test(mf)) mf = mf.replace(main, `$1\n            ${filters}$2`);
    else fail('AndroidManifest.xml has no MainActivity to open the assistant from');
    changed = true;
    console.log('✓ AndroidManifest.xml: MainActivity opens the assistant (assist gesture, voice button, icon shortcut)');
  }
  if (mf.includes('android:name=".AssistTile"')) console.log('✓ AndroidManifest.xml already declares AssistTile (no change)');
  else {
    const tile = `<service android:name=".AssistTile" android:exported="true" android:icon="@drawable/ic_stat_mali" android:label="@string/imf_assist_tile" android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">\n            <intent-filter>\n                <action android:name="android.service.quicksettings.action.QS_TILE" />\n            </intent-filter>\n        </service>`;
    mf = mf.replace(/(\s*)<\/application>/, `\n        ${tile}$1</application>`);
    changed = true;
    console.log('✓ AndroidManifest.xml: AssistTile (quick settings) declared');
  }
  if (changed) writeFileSync(manifestPath, mf);
}

// ── 3b. resources of the assistant's shortcut and tile (strings, the shortcut XML with this app's id) ──
const resSrc = join(ROOT, 'native-plugin/res');
const resDst = join(ROOT, 'android/app/src/main/res');
if (existsSync(resSrc) && existsSync(join(ROOT, 'android/app/src/main'))) {
  for (const sub of readdirSync(resSrc)) {
    mkdirSync(join(resDst, sub), { recursive: true });
    for (const f of readdirSync(join(resSrc, sub))) {
      writeFileSync(join(resDst, sub, f), readFileSync(join(resSrc, sub, f), 'utf8').replaceAll('ir.moradisadegh.marketboard', appId));
    }
  }
  console.log('✓ assistant shortcut and tile resources copied');
}

// ── 4. the built-in Persian voice (fetch-tts.mjs → android-app/tts/): engine, voice files, its Java class ──
const TTS = join(ROOT, 'tts');
const gradlePath = join(ROOT, 'android/app/build.gradle');
const ttsJava = join(ROOT, 'native-plugin/tts/EmbeddedTts.java');
const wakeJava = join(ROOT, 'native-plugin/tts/WakeService.java');
// «مالی من» (rule 75): a microphone foreground service; «display over other apps» lets it bring the app up
const WAKE_PERMS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.SYSTEM_ALERT_WINDOW'];
const WAKE_SERVICE = `<service android:name=".WakeService" android:exported="false" android:foregroundServiceType="microphone" />`;
if (existsSync(join(TTS, 'sherpa-onnx.aar')) && existsSync(join(TTS, 'voice/model.onnx')) && existsSync(gradlePath)) {
  mkdirSync(join(ROOT, 'android/app/libs'), { recursive: true });
  cpSync(join(TTS, 'sherpa-onnx.aar'), join(ROOT, 'android/app/libs/sherpa-onnx.aar'));
  const assets = join(ROOT, 'android/app/src/main/assets/tts-fa');
  rmSync(assets, { recursive: true, force: true });
  cpSync(join(TTS, 'voice'), assets, { recursive: true });
  cpSync(join(TTS, 'VERSION'), join(assets, 'VERSION'));
  writeFileSync(join(javaDir, 'EmbeddedTts.java'), readFileSync(ttsJava, 'utf8').replace(/^package [\w.]+;/m, `package ${appId};`));
  writeFileSync(join(javaDir, 'WakeService.java'), readFileSync(wakeJava, 'utf8').replace(/^package [\w.]+;/m, `package ${appId};`));
  if (existsSync(manifestPath)) {
    let mf = readFileSync(manifestPath, 'utf8');
    const before = mf;
    for (const perm of WAKE_PERMS) if (!mf.includes(`"${perm}"`)) mf = mf.replace(/(<manifest[^>]*>)/, `$1\n    <uses-permission android:name="${perm}" />`);
    if (!mf.includes('android:name=".WakeService"')) mf = mf.replace(/(\s*)<\/application>/, `\n        ${WAKE_SERVICE}$1</application>`);
    if (mf !== before) writeFileSync(manifestPath, mf);
    console.log('✓ «مالی من» listener: WakeService, its permissions and the spotter model wired');
  }
  const MARK = '// built-in Persian voice (wire-native-plugin.mjs)';
  let g = readFileSync(gradlePath, 'utf8');
  if (!g.includes(MARK)) {
    // only the 64-bit ARM engine is shipped (every phone from the last years; 24 MB per ABI otherwise), and
    // compressed in the APK: the download is what costs the user, not the one-time extraction at install
    g += `
${MARK}
dependencies {
    implementation files('libs/sherpa-onnx.aar')
    implementation 'org.jetbrains.kotlin:kotlin-stdlib:1.8.22'
}
android {
    packagingOptions {
        jniLibs {
            useLegacyPackaging true
            excludes += ['lib/armeabi-v7a/**', 'lib/x86/**', 'lib/x86_64/**']
        }
    }
}
`;
    writeFileSync(gradlePath, g);
  }
  console.log(`✓ built-in Persian voice ${readFileSync(join(TTS, 'VERSION'), 'utf8').trim()}: engine, voice files and EmbeddedTts wired`);
} else {
  rmSync(join(javaDir, 'EmbeddedTts.java'), { force: true });
  rmSync(join(javaDir, 'WakeService.java'), { force: true });
  if (existsSync(manifestPath)) {
    // no engine, no listener: the manifest must not name a class that is not there
    const mf = readFileSync(manifestPath, 'utf8');
    const out = mf.replace(/\n\s*<service android:name="\.WakeService"[^>]*\/>/, '');
    if (out !== mf) writeFileSync(manifestPath, out);
  }
  console.warn('⚠ built-in Persian voice not fetched (node scripts/fetch-tts.mjs) — the APK will use the phone\'s own voice only');
}

console.log('\nپلاگین‌های پیامک و صدا به پروژه اندروید متصل شدند.');
