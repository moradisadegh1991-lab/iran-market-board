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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// ── 2. register it in MainActivity.java ──
if (!existsSync(mainActivityPath)) {
  warnMissing(mainActivityPath, 'expected after `cap add android`; run that first.');
} else {
  let ma = readFileSync(mainActivityPath, 'utf8');
  if (ma.includes('SmsReaderPlugin')) {
    console.log('✓ MainActivity.java already registers SmsReaderPlugin (no change)');
  } else {
    if (!ma.includes(`import ${appId}.SmsReaderPlugin;`)) {
      ma = ma.replace(
        /(import com\.getcapacitor\.BridgeActivity;)/,
        `$1\nimport ${appId}.SmsReaderPlugin;`,
      );
    }
    const hasOnCreate = /void\s+onCreate\s*\(/.test(ma);
    if (hasOnCreate) {
      // insert the registerPlugin call as the first line of the existing onCreate body
      ma = ma.replace(
        /(void\s+onCreate\s*\([^)]*\)\s*\{)/,
        `$1\n        registerPlugin(SmsReaderPlugin.class);`,
      );
    } else {
      // Capacitor 6's generated MainActivity has no onCreate override at all — add one
      // handles both "{}" (empty body on one line) and "{\n}" (empty body on two lines)
      ma = ma.replace(
        /public class MainActivity extends BridgeActivity\s*\{\s*\}/,
        `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(SmsReaderPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}`,
      );
    }
    writeFileSync(mainActivityPath, ma);
    console.log(`✓ MainActivity.java now registers SmsReaderPlugin (onCreate ${hasOnCreate ? 'extended' : 'added'})`);
  }
}

// ── 3. permissions ──
if (!existsSync(manifestPath)) {
  warnMissing(manifestPath, 'expected after `cap add android`; run that first.');
} else {
  let mf = readFileSync(manifestPath, 'utf8');
  // POST_NOTIFICATIONS is required from Android 13 (API 33); without it the local
  // notification is silently dropped and nothing tells you why.
  // RECEIVE_SMS: the «نوعش چیست؟» notification the moment a bank SMS arrives (SmsAskReceiver)
  const perms = ['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS', 'android.permission.POST_NOTIFICATIONS'];
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
  if (changed) writeFileSync(manifestPath, mf);
}

console.log('\nپلاگین پیامک به پروژه اندروید متصل شد.');
