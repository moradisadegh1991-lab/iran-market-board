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
  assert.ok(mf.includes('android.permission.INTERNET'), 'existing permission must survive');
  assert.ok(existsSync(join(PKG_DIR, 'SmsReaderPlugin.java')));
  assert.equal(readFileSync(join(PKG_DIR, 'SmsReaderPlugin.java'), 'utf8').split('\n')[0], 'package ir.moradisadegh.marketboard;');
  console.log('  ✓ registered, permission added, braces balanced');

  run(); // second run
  const ma2 = readFileSync(MA, 'utf8');
  assert.equal((ma2.match(/registerPlugin\(SmsReaderPlugin\.class\)/g) || []).length, 1, 'no duplicate registration on re-run');
  assert.equal((readFileSync(MANIFEST, 'utf8').match(/READ_SMS/g) || []).length, 1, 'no duplicate permission on re-run');
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

rmSync(TMP, { recursive: true, force: true });
console.log('\nWIRE PLUGIN OK');
