#!/usr/bin/env python3
"""Smoke test of the staged built-in Persian voice (android-app/tts/voice), with the same sherpa-onnx
version the APK links: it loads, speaks a sentence of the assistant at a sane length and loudness, keeps
the ending (the « ." the app appends), and the pruned espeak-ng-data reads Persian (not silence).
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
for text, lo, hi in [
    ('دلار آزاد الان دویست و شصت و هشت هزار و سیصد تومان؛ امروز دو دهم درصد بالا رفته. .', 4.0, 9.0),
    ('ثبت کنم؟ .', 0.5, 2.0),
]:
    t0 = time.time()
    a = tts.generate(text, sid=0, speed=1.0)
    s = np.array(a.samples, dtype='float32')
    dur, rms = len(s) / a.sample_rate, float(np.sqrt((s ** 2).mean()))
    good = a.sample_rate == 22050 and lo <= dur <= hi and rms > 0.02
    ok &= good
    print(f"{'✓' if good else '✗'} {dur:.2f}s rms {rms:.3f} in {time.time() - t0:.2f}s: {text[:40]}")
print('TTS SMOKE OK' if ok else 'TTS SMOKE FAILED')
sys.exit(0 if ok else 1)
