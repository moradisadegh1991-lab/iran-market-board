#!/usr/bin/env node
/**
 * Puts the Robolectric tests of the native SMS code (native-plugin/test/robolectric) into the
 * generated Android project and adds what they need to app/build.gradle, so
 * `./gradlew :app:testDebugUnitTest` runs them against the real Android framework classes.
 * Run after wire-native-plugin.mjs. Idempotent. Test-only dependencies: nothing reaches the APK.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const appId = JSON.parse(readFileSync(join(ROOT, 'capacitor.config.json'), 'utf8')).appId;
const gradle = join(ROOT, 'android/app/build.gradle');
if (!existsSync(gradle)) {
  console.error('✗ android/app/build.gradle not found — run `npx cap add android` first');
  process.exit(1);
}
const testDir = join(ROOT, 'android/app/src/test/java', ...appId.split('.'));
mkdirSync(testDir, { recursive: true });
const src = join(ROOT, 'native-plugin/test/robolectric');
for (const f of readdirSync(src).filter((x) => x.endsWith('.java'))) {
  writeFileSync(join(testDir, f), readFileSync(join(src, f), 'utf8').replace(/^package [\w.]+;/m, `package ${appId};`));
  console.log(`✓ ${f} → ${join(testDir, f).replace(ROOT + '/', '')}`);
}
const MARK = '// native SMS tests (wire-native-tests.mjs)';
let g = readFileSync(gradle, 'utf8');
if (g.includes(MARK)) console.log('✓ app/build.gradle already set up for the tests (no change)');
else {
  g += `
${MARK}
android {
    testOptions {
        unitTests {
            includeAndroidResources = true
            all { maxHeapSize = '2g' }
        }
    }
}
dependencies {
    testImplementation 'org.robolectric:robolectric:4.14.1'
    testImplementation 'androidx.test:core:1.6.1'
}
`;
  writeFileSync(gradle, g);
  console.log('✓ app/build.gradle: Robolectric added for unit tests');
}
