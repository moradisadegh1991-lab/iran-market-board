#!/usr/bin/env python3
"""Smoke test of the staged built-in Persian voice (android-app/tts/voice), with the same sherpa-onnx
version the APK links: it loads, speaks a sentence of the assistant at a sane length and loudness, and the pruned espeak-ng-data reads Persian (not silence);
and the «مالی من» keyword spotter shipped beside it hears the name with the app's own settings (Wake.java).
Run: pip install sherpa-onnx==1.13.8 numpy && python3 scripts/tts-smoke.py"""
import os, sys, time
import numpy as np
import sherpa_onnx

V = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tts', 'voice')
cfg = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f'{V}/model.onnx', tokens=f'{V}/tokens.txt', data_dir=f'{V}/espeak-ng-data'),
        num_threads=2,
    )
)
tts = sherpa_onnx.OfflineTts(cfg)
ok = True

def f0(x, sr):
    # median pitch of the voiced frames: men ~85–155 Hz, women ~165–255 Hz
    fr, hop, out = int(0.04 * sr), int(0.01 * sr), []
    for i in range(0, len(x) - fr, hop):
        w = x[i:i + fr] - x[i:i + fr].mean()
        if np.sqrt((w ** 2).mean()) < 0.02:
            continue
        ac = np.correlate(w, w, 'full')[fr - 1:]
        lo, hi = int(sr / 400), int(sr / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.4 * ac[0]:
            out.append(sr / k)
    return float(np.median(out)) if out else 0.0

# every voice the APK carries (rule 86): it loads, speaks at a sane length and loudness, and is the voice it claims
# (the female «haaniye» above 165 Hz, the men below 155), at the speeds the user can pick
VOICES = [('ganji_adabi', V, (0.667, 0.8), 'male')] + [
    (v, os.path.join(V, 'voices', v), (0.333, 0.333) if v == 'haaniye' else (0.667, 0.8), 'female' if v == 'haaniye' else 'male')
    for v in sorted(os.listdir(os.path.join(V, 'voices'))) if os.path.isfile(os.path.join(V, 'voices', v, 'model.onnx'))
] if os.path.isdir(os.path.join(V, 'voices')) else [('ganji_adabi', V, (0.667, 0.8), 'male')]
for name, d, (ns, nw), sex in VOICES:
    t = tts if d == V else sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f'{d}/model.onnx', tokens=f'{d}/tokens.txt', data_dir=f'{V}/espeak-ng-data', noise_scale=ns, noise_scale_w=nw), num_threads=2)))
    for text, lo, hi, speed in [
        ('دلار آزاد الان دویستُ شصتُ هشت هزارُ سیصد تومنه؛ امروز دو دهم درصد رفته بالا.', 3.5, 9.0, 1.0),
        ('ثبتش کنم؟', 0.3, 2.0, 1.0),
        ('دلار آزاد الان دویستُ شصتُ هشت هزارُ سیصد تومنه.', 1.5, 7.0, 1.15),
        ('دلار آزاد الان دویستُ شصتُ هشت هزارُ سیصد تومنه.', 2.0, 8.0, 0.85),
    ]:
        t0 = time.time()
        a = t.generate(text, sid=0, speed=speed)
        s = np.array(a.samples, dtype='float32')
        dur, rms, p = len(s) / a.sample_rate, float(np.sqrt((s ** 2).mean())), f0(s, a.sample_rate)
        voiced = (p > 165) if sex == 'female' else (0 < p < 155)
        good = a.sample_rate == 22050 and lo <= dur <= hi and rms > 0.02 and (voiced or dur < 1.0)
        ok &= good
        print(f"{'✓' if good else '✗'} {name} ×{speed}: {dur:.2f}s rms {rms:.3f} f0 {p:.0f} Hz in {time.time() - t0:.2f}s: {text[:30]}")

# «مالی من» (CLAUDE.md rule 75): the shipped spotter model with exactly the keywords and thresholds Wake.java uses
# hears the name said by this voice (its randomness off, so the check is the same every run), and does not wake on
# ordinary sentences of the assistant
import re
J = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'native-plugin', 'java', 'Wake.java'), encoding='utf-8').read()
def arr(name):
    return re.findall(r'"([A-Z0-9 ]+ @MALI_MAN)"', re.search(name + r' = \{([^}]*)\}', J).group(1))
def num(name, which):
    return float(re.search(r'static float ' + name + r'\(String sensitivity\) \{\s*return "careful"\.equals\(sensitivity\) \? ([0-9.]+)f : ([0-9.]+)f', J).group(2 if which == 'sensitive' else 1))
K = os.path.join(V, 'kws')
quiet = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f'{V}/model.onnx', tokens=f'{V}/tokens.txt', data_dir=f'{V}/espeak-ng-data', noise_scale=0.0, noise_scale_w=0.0),
    num_threads=2)))
def wakes(spotter, text, speed):
    a = quiet.generate(text, sid=0, speed=speed)
    s = np.array(a.samples, dtype='float32')
    n = int(len(s) * 16000 / a.sample_rate)
    s = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s).astype('float32')
    s = np.concatenate([np.zeros(8000, 'float32'), s, np.zeros(16000, 'float32')])
    st, c = spotter.create_stream(), 0
    for i in range(0, len(s), 1600):  # 100 ms, as WakeService reads
        st.accept_waveform(16000, s[i:i + 1600])
        while spotter.is_ready(st):
            spotter.decode_stream(st)
            if spotter.get_result(st):
                c += 1
                spotter.reset_stream(st)
    return c
NAME = ['مالی من', 'سلام مالی من', 'مالی من، قیمت دلار چنده؟', 'مالی من، دیروز سی هزار تومن نون خریدم', 'مالی من، موجودی حسابم چقدره؟']
OTHER = ['دلار آزاد الان دویستُ شصتُ هشت هزارُ سیصد تومنه؛ امروز یکُ دو دهم درصد رفته بالا.', 'هزینه بود، درآمد، یا انتقال بین حساب‌های خودت؟',
         'متوجه نشدم. می‌تونید تراکنش بگید یا قیمتُ نمودار بپرسید.', 'از کدوم حساب یا کارت؟ کیف پول نقد، بانک ملت؟']
import tempfile
# the voice is not bit-identical across CPUs even with its randomness off (this sandbox: 15/15 and 11/15; a GitHub
# runner: 14/15 and 12/15), so the bar leaves room: a broken model or wrong keywords hear next to nothing
for sens, need in [('sensitive', 12), ('careful', 8)]:
    kw = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8')
    kw.write('\n'.join(arr('SENSITIVE' if sens == 'sensitive' else 'CAREFUL')) + '\n')
    kw.close()
    spotter = sherpa_onnx.KeywordSpotter(tokens=f'{K}/tokens.txt', encoder=f'{K}/encoder.int8.onnx', decoder=f'{K}/decoder.onnx', joiner=f'{K}/joiner.int8.onnx',
        keywords_file=kw.name, num_threads=1, keywords_threshold=num('threshold', sens), keywords_score=num('boost', sens), max_active_paths=4)
    heard = sum(1 for t in NAME for sp in (0.9, 1.0, 1.15) if wakes(spotter, t, sp))
    false = sum(wakes(spotter, t, 1.0) for t in OTHER)
    good = heard >= need and false == 0
    ok &= good
    print(f"{'✓' if good else '✗'} «مالی من» {sens}: heard {heard}/15 (need {need}), false wakes {false} in {len(OTHER)} sentences")

print('TTS SMOKE OK' if ok else 'TTS SMOKE FAILED')
sys.exit(0 if ok else 1)
