#!/usr/bin/env python3
"""How well the «مالی من» listener hears its name, and how often it wakes on other speech (CLAUDE.md rule 75).
The numbers in Wake.java come from this. Real people's voices were not available: the name and the other speech are
said by six Persian TTS voices × three speeds, so read the result as a comparison of settings, not as the rate on a
real phone.

  positives: «مالی من» alone and at the start of four sentences — 72 clips
  negatives: 36 sentences (the assistant's own, and near-sounding ones: «این مال منه», «مالیات من», «عالی من»…)
             × the same voices and speeds — about 29 minutes

Run (about 30 minutes on 4 cores; the voices, ~400 MB, are downloaded once into --cache):
  pip install sherpa-onnx==1.13.8 numpy && node scripts/fetch-tts.mjs && python3 scripts/kws-eval.py --cache /tmp/kws-eval
"""
import argparse, glob, os, re, subprocess, tempfile
import numpy as np
import sherpa_onnx

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(HERE, '..', 'tts', 'voice', 'kws')
J = open(os.path.join(HERE, '..', 'native-plugin', 'java', 'Wake.java'), encoding='utf-8').read()
VOICES = ['vits-piper-fa_IR-ganji_adabi-medium-int8', 'vits-piper-fa_IR-ganji-medium-int8', 'vits-mimic3-fa-haaniye_low',
          'vits-piper-fa_IR-amir-medium-int8', 'vits-piper-fa_IR-gyro-medium-int8', 'vits-piper-fa_IR-reza_ibrahim-medium-int8']
NAME = ['مالی من', 'مالی من، قیمت دلار چنده؟', 'سلام مالی من', 'مالی من، دیروز سی هزار تومن نون خریدم']
OTHER = [
    'دلار آزاد الان دویستُ شصتُ هشت هزارُ سیصد تومنه؛ امروز یکُ دو دهم درصد رفته بالا.', 'سیُ پنج هزار تومن هزینه، دسته خوراک، از کیف پول نقد، دیروز. ثبت کنم؟',
    'این ماه دو میلیونُ پونصدُ ده هزار تومن خرج کردی.', 'موجودی بانک ملت بیستُ هشت میلیونُ نهصد هزار تومنه.', 'مبلغش چقدر بود؟',
    'هزینه بود، درآمد، یا انتقال بین حساب‌های خودت؟', 'دسته‌اش چیه؟ مثلاً خوراک، حمل‌ونقل یا خرید.', 'باشه، چیزی ثبت نشد.',
    'از کدوم حساب یا کارت؟ کیف پول نقد، بانک ملت؟', 'برگردیم به تراکنش. مبلغش چقدر بود؟', 'متوجه نشدم. می‌تونید تراکنش بگید یا قیمتُ نمودار بپرسید.',
    'دارایی خالصت حدود بیستُ هشت میلیونُ ششصدُ نود هزار تومنه.', 'ثبت شد.', 'چه روزی بود؟ مثلاً دیروز، یا دوازدهم مهر.',
    'نودُ نُه هزار تومن قبض برق پرداخت کردم.', 'هر گرم طلای هجده عیار توی سه ماه گذشته رفته بالا.', 'سکه امامی الان تغییری نکرده.',
    'بیت کوین الان شصتُ یک هزار دلاره.', 'حقوق این ماه واریز شد.', 'قسط وام فردا سررسیده.', 'یه چیزی خریدم.', 'قیمت سکه چنده؟',
    'نمودار یک ساله دلار رو نشون بده.', 'این هفته چقدر خرج کردم؟',
    'مالیات من چقدره؟', 'این مال منه', 'حالم عالیه', 'عالی من', 'مالی ندارم', 'حال من خوبه', 'مالیاتم رو دادم', 'ملی من', 'مالکیت من',
    'ماهی من کجاست', 'سالی یک بار', 'مالی و اداری',
]


def arr(name):
    return re.findall(r'"([A-Z0-9 ]+ @MALI_MAN)"', re.search(name + r' = \{([^}]*)\}', J).group(1))


def num(name, sens):
    m = re.search(r'static float ' + name + r'\(String sensitivity\) \{\s*return "careful"\.equals\(sensitivity\) \? ([0-9.]+)f : ([0-9.]+)f', J)
    return float(m.group(1 if sens == 'careful' else 2))


def voice(cache, v):
    d = os.path.join(cache, v)
    if not os.path.isdir(d):
        tar = d + '.tar.bz2'
        subprocess.run(['curl', '-sSL', '-o', tar, f'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{v}.tar.bz2'], check=True)
        subprocess.run(['tar', 'xjf', tar, '-C', cache], check=True)
    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=glob.glob(d + '/*.onnx')[0], tokens=d + '/tokens.txt', data_dir=d + '/espeak-ng-data'), num_threads=4)))


def to16k(a):
    s = np.array(a.samples, dtype='float32')
    n = int(len(s) * 16000 / a.sample_rate)
    return np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s).astype('float32')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='/tmp/kws-eval')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    pos, neg = [], []
    for v in VOICES:
        t = voice(args.cache, v)
        for sp in (0.9, 1.0, 1.15):
            pos += [to16k(t.generate(x, sid=0, speed=sp)) for x in NAME]
            neg += [(x, to16k(t.generate(x, sid=0, speed=sp))) for x in OTHER]
    print(f'{len(pos)} clips of the name, {sum(len(a) for _, a in neg) / 16000 / 60:.1f} minutes of other speech')
    for sens in ('sensitive', 'careful'):
        kw = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8')
        kw.write('\n'.join(arr('SENSITIVE' if sens == 'sensitive' else 'CAREFUL')) + '\n')
        kw.close()
        k = sherpa_onnx.KeywordSpotter(tokens=f'{K}/tokens.txt', encoder=f'{K}/encoder.int8.onnx', decoder=f'{K}/decoder.onnx', joiner=f'{K}/joiner.int8.onnx',
                                       keywords_file=kw.name, num_threads=4, keywords_threshold=num('threshold', sens), keywords_score=num('boost', sens), max_active_paths=4)

        def wakes(sig):
            st, c = k.create_stream(), 0
            sig = np.concatenate([np.zeros(8000, 'float32'), sig, np.zeros(16000, 'float32')])
            for i in range(0, len(sig), 1600):
                st.accept_waveform(16000, sig[i:i + 1600])
                while k.is_ready(st):
                    k.decode_stream(st)
                    if k.get_result(st):
                        c += 1
                        k.reset_stream(st)
            return c
        heard = sum(1 for a in pos if wakes(a))
        by = {}
        for x, a in neg:
            n = wakes(a)
            if n:
                by[x] = by.get(x, 0) + n
        print(f'{sens}: heard {heard}/{len(pos)}, false wakes {sum(by.values())}: {by}')


if __name__ == '__main__':
    main()
