// The same SMS parser the Android app uses (android-app/www/sms-parser.js, locked by
// android-app/scripts/sms-parser-test.mjs), so a message is read identically in both apps.
import parser from '@/android-app/www/sms-parser.js';
import type { SmsApi } from './importers';

export const smsParser: SmsApi = parser;
