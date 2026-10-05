/** Proves scripts/wire-native-plugin.mjs correctly handles both real MainActivity.java shapes
 *  Capacitor generates, is idempotent, and never touches other plugins' code. */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = '/tmp/wire-plugin-test-' + Date.now();
const PKG_DIR = join(TMP, 'android/app/src/main/java/ir/moradisadegh/marketboard');
const MA = join(PKG_DIR, 'MainActivity.java');
const MANIFEST = join(TMP, 'android/app/src/main/AndroidManifest.xml');

function scaffold(mainActivityBody, manifestBody) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(PKG_DIR, { recursive: true });
  cpSync(join(ROOT, 'native-plugin'), join(TMP, 'native-plugin'), { recursive: true });
  cpSync(join(ROOT, 'capacitor.config.json'), join(TMP, 'capacitor.config.json'));
  mkdirSync(join(TMP, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts/wire-native-plugin.mjs'), join(TMP, 'scripts/wire-native-plugin.mjs'));
  writeFileSync(MA, mainActivityBody);
  writeFileSync(MANIFEST, manifestBody);
}
function run() { execFileSync('node', ['scripts/wire-native-plugin.mjs'], { cwd: TMP }); }

console.log('scenario A: Capacitor 6 default MainActivity (empty body, no onCreate)');
{
  scaffold(
    'package ir.moradisadegh.marketboard;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n',
    '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="@string/app_name"><activity android:name=".MainActivity" /></application>\n    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n',
  );
  run();
  const ma = readFileSync(MA, 'utf8');
  assert.ok(ma.includes('registerPlugin(SmsReaderPlugin.class);'), 'plugin must be registered');
  assert.ok(/onCreate\s*\([^)]*\)\s*\{\s*registerPlugin/.test(ma.replace(/\n/g, '')), 'registerPlugin must be the first statement');
  assert.equal((ma.match(/public class MainActivity/g) || []).length, 1, 'class declared exactly once');
  assert.equal((ma.match(/\{/g) || []).length, (ma.match(/\}/g) || []).length, 'braces balanced');
  const mf = readFileSync(MANIFEST, 'utf8');
  assert.ok(mf.includes('android.permission.READ_SMS'));
  assert.ok(mf.includes('android.permission.POST_NOTIFICATIONS'), 'Android 13+ needs this or notifications are silently dropped');
  assert.ok(mf.includes('android.permission.INTERNET'), 'existing permission must survive');
  assert.ok(existsSync(join(PKG_DIR, 'SmsReaderPlugin.java')));
  assert.equal(readFileSync(join(PKG_DIR, 'SmsReaderPlugin.java'), 'utf8').split('\n')[0], 'package ir.moradisadegh.marketboard;');
  for (const f of ['BankSms.java', 'SmsAsk.java', 'SmsAskReceiver.java', 'SmsChoiceReceiver.java'])
    assert.ok(existsSync(join(PKG_DIR, f)), f + ' copied with the plugin');
  assert.ok(!existsSync(join(PKG_DIR, 'BankSmsCli.java')), 'test drivers stay out of the app');
  assert.ok(mf.includes('android.permission.RECEIVE_SMS'), 'the ask notification needs SMS_RECEIVED');
  // the SMS receiver only from the system; the button receiver only from the app itself
  assert.match(mf, /<receiver android:name="\.SmsAskReceiver" android:exported="true" android:permission="android\.permission\.BROADCAST_SMS">\s*<intent-filter>\s*<action android:name="android\.provider\.Telephony\.SMS_RECEIVED" \/>/);
  assert.match(mf, /<receiver android:name="\.SmsChoiceReceiver" android:exported="false" \/>[\s\S]*<\/application>/);
  // the voice assistant: its plugin, the mic, and the speech services Android 11+ hides otherwise
  assert.ok(ma.includes('registerPlugin(VoicePlugin.class);'), 'voice plugin registered');
  assert.ok(ma.includes('import ir.moradisadegh.marketboard.VoicePlugin;'));
  assert.ok(existsSync(join(PKG_DIR, 'VoicePlugin.java')));
  assert.ok(mf.includes('android.permission.RECORD_AUDIO'));
  assert.match(mf, /<queries>[\s\S]*android\.speech\.RecognitionService[\s\S]*android\.intent\.action\.TTS_SERVICE[\s\S]*<\/queries>\s*<application/, '<queries> is a child of <manifest>, before <application>');
  // the assistant from anywhere: assist gesture + voice button + icon shortcut on MainActivity, and the tile
  assert.match(mf, /<activity android:name="\.MainActivity">[\s\S]*android\.intent\.action\.ASSIST[\s\S]*android\.intent\.action\.VOICE_COMMAND[\s\S]*@xml\/assist_shortcuts[\s\S]*<\/activity>/);
  assert.match(mf, /<service android:name="\.AssistTile" android:exported="true"[^>]*BIND_QUICK_SETTINGS_TILE">\s*<intent-filter>\s*<action android:name="android\.service\.quicksettings\.action\.QS_TILE" \/>/);
  assert.ok(existsSync(join(PKG_DIR, 'AssistTile.java')));
  console.log('  ✓ registered, permissions added, receivers declared inside <application>, braces balanced');

  run(); // second run
  const ma2 = readFileSync(MA, 'utf8');
  assert.equal((ma2.match(/registerPlugin\(SmsReaderPlugin\.class\)/g) || []).length, 1, 'no duplicate registration on re-run');
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/READ_SMS/g) || []).length, 1, 'no duplicate permission on re-run');
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/POST_NOTIFICATIONS/g) || []).length, 1, 'no duplicate notification permission either');
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/SmsAskReceiver/g) || []).length, 1, 'no duplicate receiver');
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/SmsChoiceReceiver/g) || []).length, 1, 'no duplicate receiver');
  assert.equal((ma2.match(/registerPlugin\(VoicePlugin\.class\)/g) || []).length, 1);
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/<queries>/g) || []).length, 1);
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/RECORD_AUDIO/g) || []).length, 1);
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/android\.intent\.action\.ASSIST/g) || []).length, 1);
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/AssistTile/g) || []).length, 1);
  console.log('  ✓ idempotent: second run changed nothing');
}

console.log('\nscenario B: MainActivity already has onCreate with other setup code');
{
  scaffold(
    'package ir.moradisadegh.marketboard;\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        System.out.println("some other plugin\'s setup");\n    }\n}\n',
    '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="@string/app_name"><activity android:name=".MainActivity" /></application>\n</manifest>\n',
  );
  run();
  const ma = readFileSync(MA, 'utf8');
  assert.ok(ma.includes('registerPlugin(SmsReaderPlugin.class);'));
  assert.ok(ma.includes('registerPlugin(VoicePlugin.class);'));
  assert.ok(ma.includes('some other plugin\'s setup'), 'pre-existing onCreate body must be preserved');
  assert.equal((ma.match(/void onCreate/g) || []).length, 1, 'exactly one onCreate, not a duplicate');
  assert.equal((ma.match(/\{/g) || []).length, (ma.match(/\}/g) || []).length, 'braces balanced');
  console.log('  ✓ existing onCreate extended, other code untouched');

  run();
  assert.equal((readFileSync(MA, 'utf8').match(/registerPlugin\(SmsReaderPlugin\.class\)/g) || []).length, 1);
  console.log('  ✓ idempotent on this shape too');
}

console.log('\nscenario C: android/ platform not added yet');
{
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'native-plugin'), join(TMP, 'native-plugin'), { recursive: true });
  cpSync(join(ROOT, 'capacitor.config.json'), join(TMP, 'capacitor.config.json'));
  cpSync(join(ROOT, 'scripts/wire-native-plugin.mjs'), join(TMP, 'scripts/wire-native-plugin.mjs'));
  let threw = false;
  try { run(); } catch (e) { threw = true; }
  assert.equal(threw, false, 'must exit 0 and just warn, not fail the build');
  console.log('  ✓ warns and exits cleanly when android/ does not exist yet');
}

console.log('\nscenario D: the built-in Persian voice fetched (fetch-tts.mjs)');
{
  scaffold(
    'package ir.moradisadegh.marketboard;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n',
    '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="@string/app_name"><activity android:name=".MainActivity" /></application>\n</manifest>\n',
  );
  const GRADLE = join(TMP, 'android/app/build.gradle');
  writeFileSync(GRADLE, 'apply plugin: "com.android.application"\n');
  run();
  assert.ok(!existsSync(join(PKG_DIR, 'EmbeddedTts.java')), 'without the voice, its class is not compiled in');
  mkdirSync(join(TMP, 'tts/voice/espeak-ng-data/lang/ira'), { recursive: true });
  writeFileSync(join(TMP, 'tts/sherpa-onnx.aar'), 'aar');
  writeFileSync(join(TMP, 'tts/voice/model.onnx'), 'onnx');
  writeFileSync(join(TMP, 'tts/voice/tokens.txt'), 'tok');
  writeFileSync(join(TMP, 'tts/voice/espeak-ng-data/lang/ira/fa'), 'fa');
  writeFileSync(join(TMP, 'tts/VERSION'), 'v1\n');
  run();
  run(); // idempotent
  assert.equal(readFileSync(join(TMP, 'android/app/libs/sherpa-onnx.aar'), 'utf8'), 'aar');
  assert.equal(readFileSync(join(TMP, 'android/app/src/main/assets/tts-fa/model.onnx'), 'utf8'), 'onnx');
  assert.equal(readFileSync(join(TMP, 'android/app/src/main/assets/tts-fa/espeak-ng-data/lang/ira/fa'), 'utf8'), 'fa');
  assert.equal(readFileSync(join(TMP, 'android/app/src/main/assets/tts-fa/VERSION'), 'utf8'), 'v1\n');
  assert.equal(readFileSync(join(PKG_DIR, 'EmbeddedTts.java'), 'utf8').split('\n')[0], 'package ir.moradisadegh.marketboard;');
  const g = readFileSync(GRADLE, 'utf8');
  assert.equal((g.match(/implementation files\('libs\/sherpa-onnx\.aar'\)/g) || []).length, 1, 'gradle patched once');
  assert.match(g, /excludes \+= \['lib\/armeabi-v7a\/\*\*', 'lib\/x86\/\*\*', 'lib\/x86_64\/\*\*'\]/);
  // «مالی من» (rule 75): the listener service, once, with its permissions
  const mf = readFileSync(join(TMP, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(existsSync(join(PKG_DIR, 'WakeService.java')));
  assert.equal((mf.match(/android:name="\.WakeService"/g) || []).length, 1, 'WakeService declared once');
  assert.match(mf, /<service android:name="\.WakeService" android:exported="false" android:foregroundServiceType="microphone" \/>/);
  for (const p of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'SYSTEM_ALERT_WINDOW']) {
    assert.equal((mf.match(new RegExp(`"android\\.permission\\.${p}"`, 'g')) || []).length, 1, `${p} once`);
  }
  // the voice gone again (a build without it): no class, and the manifest names no missing service
  rmSync(join(TMP, 'tts'), { recursive: true, force: true });
  run();
  assert.ok(!existsSync(join(PKG_DIR, 'WakeService.java')));
  assert.ok(!readFileSync(join(TMP, 'android/app/src/main/AndroidManifest.xml'), 'utf8').includes('.WakeService'));
  console.log('  ✓ engine, voice files, EmbeddedTts and the «مالی من» listener wired; gradle patched once; without it nothing is');
}

rmSync(TMP, { recursive: true, force: true });
console.log('\nWIRE PLUGIN OK');
