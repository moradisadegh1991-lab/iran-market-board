// android-app/www/sms-parser.js is plain JS shared with the Android app; this gives the web app its type.
declare module '@/android-app/www/sms-parser.js' {
  const api: import('@/lib/finance/importers').SmsApi;
  export default api;
}

// pdf.js worker module, loaded into the page so pdf.js runs without a separate Worker file
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
