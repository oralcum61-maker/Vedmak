# Звуки системы (PLAN 4.66): синтез с нуля — без чужих записей и лицензий, можно класть в выпуск.
# Каждый звук — короткая сумма шума, фильтров и затухающих частичных; реверберация — свёртка с затухающим шумом.
# Нужны numpy, scipy и ffmpeg (libvorbis). Запуск из корня: python tools/make-sounds.py
import os, subprocess, tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "sounds")
rng = np.random.default_rng(1337)  # одно и то же зерно — одни и те же файлы при пересборке


def t(dur):
    return np.arange(int(SR * dur)) / SR


def noise(dur):
    return rng.standard_normal(int(SR * dur))


def env(dur, attack=0.005, decay=None, curve=4.0):
    """Огибающая: быстрая атака, экспоненциальный спад."""
    n = int(SR * dur)
    a = max(1, int(SR * attack))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    rest = n - a
    if rest > 0:
        e[a:] = np.exp(-curve * np.linspace(0, 1, rest)) if decay is None else np.exp(-np.arange(rest) / (SR * decay))
    return e


def band(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lowpass(x, f, order=4):
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=SR, output="sos"), x)


def highpass(x, f, order=4):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=SR, output="sos"), x)


def sweep_filter(x, f0, f1, q=2.0, steps=64):
    """Полосовой фильтр, частота которого едет от f0 к f1 — свист ветра и клинка."""
    out = np.zeros_like(x)
    seg = len(x) // steps + 1
    for i in range(steps):
        a, b = i * seg, min(len(x), (i + 1) * seg + seg // 2)
        if a >= len(x):
            break
        f = f0 * (f1 / f0) ** (i / max(1, steps - 1))
        lo, hi = max(30, f / (1 + 1 / q)), min(SR / 2 - 100, f * (1 + 1 / q))
        chunk = band(x[a:b], lo, hi, 2)
        w = np.hanning(len(chunk))
        out[a:b] += chunk * w
    return out


def partials(dur, freqs, decays, amps=None, detune=0.0):
    """Металл: набор негармоничных частичных, каждая затухает по-своему."""
    tt = t(dur)
    amps = amps or [1.0] * len(freqs)
    y = np.zeros_like(tt)
    for f, d, a in zip(freqs, decays, amps):
        ph = rng.uniform(0, 2 * np.pi)
        y += a * np.sin(2 * np.pi * f * (1 + detune * rng.uniform(-1, 1)) * tt + ph) * np.exp(-tt / d)
    return y


def pluck(dur, f, decay=0.996):
    """Струна (Карплус — Стронг): тетива лука."""
    n = int(SR * dur)
    p = int(SR / f)
    buf = rng.uniform(-1, 1, p)
    y = np.zeros(n)
    for i in range(n):
        y[i] = buf[i % p]
        buf[i % p] = decay * 0.5 * (buf[i % p] + buf[(i + 1) % p])
    return y


def reverb(x, size=0.6, mix=0.25):
    ir = noise(size) * np.exp(-np.linspace(0, 6, int(SR * size)))
    ir = lowpass(ir, 5000)
    wet = signal.fftconvolve(x, ir)[: len(x) + int(SR * size)]
    dry = np.concatenate([x, np.zeros(len(wet) - len(x))])
    wet /= np.max(np.abs(wet)) + 1e-9
    return dry * (1 - mix) + wet * mix * np.max(np.abs(x))


def pad(x, dur):
    n = int(SR * dur)
    return np.concatenate([x, np.zeros(max(0, n - len(x)))])[:n] if n >= len(x) else x


def mix(*parts):
    n = max(len(p) for p in parts)
    y = np.zeros(n)
    for p in parts:
        y[: len(p)] += p
    return y


def at(x, sec):
    return np.concatenate([np.zeros(int(SR * sec)), x])


def finish(x, peak=0.89):
    x = x - np.mean(x)
    fade = min(len(x), int(SR * 0.02))
    x[-fade:] *= np.linspace(1, 0, fade)
    return x / (np.max(np.abs(x)) + 1e-9) * peak


# ---------------------------------------------------------------- Бой
def swing(heavy=False):
    d = 0.5 if heavy else 0.36
    y = sweep_filter(noise(d), 2600 if not heavy else 1500, 500 if not heavy else 260, q=3)
    e = np.sin(np.linspace(0, np.pi, len(y))) ** 1.6
    return finish(y * e)


def miss():
    y = sweep_filter(noise(0.3), 3500, 900, q=3) * np.sin(np.linspace(0, np.pi, int(SR * 0.3))) ** 2
    return finish(y, 0.6)


def hit():
    d = 0.32
    thump = np.sin(2 * np.pi * 70 * t(d) * np.exp(-t(d) * 8)) * env(d, 0.002, 0.07)
    slap = band(noise(d), 600, 3000) * env(d, 0.001, 0.025)
    crunch = band(noise(d), 1800, 6000) * env(d, 0.001, 0.012) * 0.5
    return finish(reverb(mix(thump * 1.2, slap * 0.8, crunch), 0.25, 0.12))


def hit_crit():
    d = 0.8
    thump = np.sin(2 * np.pi * 55 * t(d) * np.exp(-t(d) * 6)) * env(d, 0.002, 0.12)
    crack = band(noise(d), 900, 7000) * env(d, 0.001, 0.03)
    ring = partials(d, [523, 1310, 2290, 3440], [0.5, 0.3, 0.2, 0.12], [0.3, 0.2, 0.12, 0.08])
    return finish(reverb(mix(thump * 1.4, crack, ring * 0.6), 0.6, 0.25))


def block():
    d = 1.1
    clang = partials(d, [410, 1130, 1870, 2650, 3720, 5100], [0.6, 0.4, 0.28, 0.2, 0.12, 0.07],
                     [1, 0.7, 0.5, 0.35, 0.25, 0.15], detune=0.01)
    strike = band(noise(d), 2000, 9000) * env(d, 0.0005, 0.01)
    return finish(reverb(mix(clang * env(d, 0.001, 0.4), strike * 0.8), 0.7, 0.25))


def parry():
    d = 0.75
    scrape = sweep_filter(noise(d), 6000, 2500, q=6) * env(d, 0.01, 0.25)
    ring = partials(d, [1470, 2930, 4410], [0.35, 0.22, 0.15], [0.6, 0.35, 0.2])
    return finish(reverb(mix(scrape, ring * 0.7, at(block()[: int(SR * 0.4)] * 0.5, 0.0)), 0.5, 0.2))


def fumble():
    parts = []
    for i, f in enumerate([520, 380, 610, 300]):
        c = partials(0.3, [f, f * 2.7, f * 4.1], [0.12, 0.08, 0.05], [1, 0.5, 0.3]) + band(noise(0.3), 1500, 6000) * env(0.3, 0.0005, 0.008)
        parts.append(at(c * (1 - i * 0.18), 0.09 * i + rng.uniform(0, 0.03)))
    return finish(reverb(mix(*parts), 0.4, 0.2))


def bow():
    d = 0.6
    twang = pluck(d, 110, 0.993) * env(d, 0.001, 0.18)
    whoosh = at(sweep_filter(noise(0.35), 4000, 1500, q=4) * np.sin(np.linspace(0, np.pi, int(SR * 0.35))) ** 2, 0.05)
    return finish(mix(twang, whoosh * 0.5))


def crossbow():
    d = 0.55
    thunk = np.sin(2 * np.pi * 120 * t(d) * np.exp(-t(d) * 10)) * env(d, 0.001, 0.05) + band(noise(d), 400, 2500) * env(d, 0.0005, 0.02)
    twang = pluck(d, 180, 0.99) * env(d, 0.001, 0.1) * 0.6
    whoosh = at(sweep_filter(noise(0.3), 5000, 2000, q=4) * np.sin(np.linspace(0, np.pi, int(SR * 0.3))) ** 2, 0.04)
    return finish(mix(thunk, twang, whoosh * 0.5))


def death():
    d = 2.6
    toll = partials(d, [98, 196 * 1.01, 247, 392, 588, 830], [1.6, 1.1, 0.9, 0.6, 0.4, 0.25], [1, 0.6, 0.5, 0.35, 0.2, 0.12])
    rumble = lowpass(noise(d), 120) * env(d, 0.2, 0.9) * 2
    return finish(reverb(mix(toll * env(d, 0.003, 1.2), rumble), 1.2, 0.35))


# ---------------------------------------------------------------- Магия
def aard():
    d = 1.0
    gust = sweep_filter(noise(d), 300, 1800, q=1.5) * np.sin(np.linspace(0, np.pi, int(SR * d))) ** 0.8
    boom = np.sin(2 * np.pi * 50 * t(d) * np.exp(-t(d) * 4)) * env(d, 0.003, 0.15)
    return finish(reverb(mix(gust, boom * 0.9), 0.6, 0.2))


def igni():
    d = 1.3
    roar = band(noise(d), 150, 1600) * (env(d, 0.06, 0.5) * (1 + 0.3 * np.sin(2 * np.pi * 9 * t(d))))
    crackle = np.zeros(int(SR * d))
    for _ in range(70):
        p = int(rng.uniform(0, d * 0.85) * SR)
        c = highpass(noise(0.015), 2500) * env(0.015, 0.0005, 0.003)
        crackle[p:p + len(c)] += c * rng.uniform(0.3, 1)
    whump = np.sin(2 * np.pi * 65 * t(d) * np.exp(-t(d) * 5)) * env(d, 0.004, 0.12)
    return finish(mix(roar, crackle * 0.5, whump * 0.8))


def quen():
    d = 1.4
    tt = t(d)
    chord = sum(np.sin(2 * np.pi * f * tt * (1 + 0.004 * np.sin(2 * np.pi * 5 * tt))) for f in [392, 587, 784, 1175])
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * 11 * tt)
    shimmer = band(noise(d), 4000, 9000) * 0.15
    e = np.minimum(1, tt / 0.15) * np.exp(-np.maximum(0, tt - 0.3) * 2.2)
    return finish(reverb((chord * trem + shimmer) * e, 0.8, 0.3))


def axii():
    d = 1.3
    tt = t(d)
    f = 520 * np.exp(-tt * 0.6)
    ph = 2 * np.pi * np.cumsum(f) / SR
    wob = np.sin(ph * (1 + 0.02 * np.sin(2 * np.pi * 6 * tt))) + 0.6 * np.sin(ph * 1.503) + 0.4 * np.sin(ph * 0.5)
    e = np.minimum(1, tt / 0.2) * np.exp(-np.maximum(0, tt - 0.4) * 2.5)
    return finish(reverb(wob * e, 0.9, 0.35))


def yrden():
    d = 1.6
    tt = t(d)
    hum = (np.sin(2 * np.pi * 73 * tt) + 0.5 * np.sin(2 * np.pi * 146 * tt) + 0.3 * np.sin(2 * np.pi * 219.5 * tt))
    hum *= np.minimum(1, tt / 0.3) * np.exp(-np.maximum(0, tt - 0.6) * 2)
    chime = at(partials(1.0, [1318, 1975, 2637], [0.5, 0.35, 0.25], [0.5, 0.3, 0.2]), 0.25)
    return finish(reverb(mix(hum * 0.8, chime), 1.0, 0.3))


def spell():
    d = 1.1
    tt = t(d)
    f = 300 + 900 * tt / d
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = (np.sin(ph) + 0.4 * np.sin(2.01 * ph)) * np.sin(np.linspace(0, np.pi, len(tt))) ** 1.5
    air = sweep_filter(noise(d), 800, 5000, q=2) * 0.5 * np.sin(np.linspace(0, np.pi, len(tt)))
    return finish(reverb(tone * 0.6 + air, 0.7, 0.3))


# ---------------------------------------------------------------- Алхимия
def drink():
    parts = []
    for i in range(3):
        d = 0.18
        tt = t(d)
        f = 180 + 260 * tt / d
        gulp = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.linspace(0, np.pi, len(tt))) ** 2
        parts.append(at(lowpass(gulp + band(noise(d), 200, 900) * 0.3, 1200) * env(d, 0.01, 0.08), 0.24 * i))
    pop = at(partials(0.3, [880, 1320], [0.08, 0.05]), 0.8)
    return finish(mix(*parts, pop * 0.4))


def bomb():
    d = 1.8
    burst = lowpass(noise(d), 1800) * env(d, 0.002, 0.25)
    boom = np.sin(2 * np.pi * 45 * t(d) * np.exp(-t(d) * 3)) * env(d, 0.002, 0.35) * 1.6
    debris = band(noise(d), 1500, 6000) * env(d, 0.01, 0.4) * 0.3 * (rng.uniform(0, 1, int(SR * d)) > 0.97)
    glass = at(partials(0.5, [2400, 3700, 5300], [0.15, 0.1, 0.07], [0.4, 0.3, 0.2]), 0.0)
    return finish(reverb(mix(burst, boom, debris, glass * 0.5), 1.0, 0.3))


def oil():
    d = 0.8
    sizzle = band(noise(d), 3000, 9000) * env(d, 0.05, 0.3) * (0.6 + 0.4 * rng.uniform(0, 1, int(SR * d)))
    shing = at(partials(0.5, [2100, 4200, 6300], [0.2, 0.12, 0.08], [0.5, 0.3, 0.2]), 0.1)
    return finish(mix(sizzle * 0.6, shing))


# ---------------------------------------------------------------- Интерфейс
def ui_click():
    d = 0.07
    return finish(partials(d, [2400, 5100], [0.012, 0.008], [1, 0.4]) + band(noise(d), 3000, 8000) * env(d, 0.0003, 0.004) * 0.4, 0.5)


def ui_coin():
    a = partials(0.45, [2093, 3140, 4400, 6200], [0.25, 0.15, 0.1, 0.06], [1, 0.6, 0.35, 0.2])
    b = at(partials(0.35, [2637, 3950, 5600], [0.18, 0.12, 0.07], [0.8, 0.45, 0.25]), 0.07)
    return finish(mix(a, b), 0.6)


def ui_turn():
    d = 1.5
    bell = partials(d, [659, 1318 * 1.003, 1978, 2637, 3600], [0.9, 0.6, 0.4, 0.3, 0.18], [1, 0.5, 0.35, 0.25, 0.12])
    return finish(reverb(bell * env(d, 0.002, 0.6), 0.8, 0.25), 0.7)


def ui_success():
    a = partials(0.5, [784, 1568], [0.25, 0.15], [1, 0.3])
    b = at(partials(0.5, [1175, 2350], [0.3, 0.18], [1, 0.3]), 0.09)
    return finish(reverb(mix(a, b), 0.4, 0.2), 0.55)


def ui_fail():
    d = 0.4
    thud = np.sin(2 * np.pi * 110 * t(d) * np.exp(-t(d) * 6)) * env(d, 0.002, 0.08)
    dull = partials(d, [196, 233], [0.12, 0.1], [0.6, 0.4])
    return finish(mix(thud, dull), 0.55)


def ui_crit():
    d = 1.0
    ring = partials(d, [1046, 1568, 2093, 3136, 4186], [0.6, 0.45, 0.35, 0.22, 0.14], [1, 0.7, 0.5, 0.3, 0.15])
    sweep = sweep_filter(noise(0.5), 3000, 9000, q=3) * np.sin(np.linspace(0, np.pi, int(SR * 0.5))) * 0.3
    return finish(reverb(mix(ring, sweep), 0.7, 0.3), 0.65)


SOUNDS = {
    "swing": swing, "swing-heavy": lambda: swing(True), "miss": miss, "hit": hit, "hit-crit": hit_crit,
    "block": block, "parry": parry, "fumble": fumble, "bow": bow, "crossbow": crossbow, "death": death,
    "aard": aard, "igni": igni, "quen": quen, "axii": axii, "yrden": yrden, "spell": spell,
    "drink": drink, "bomb": bomb, "oil": oil,
    "ui-click": ui_click, "ui-coin": ui_coin, "ui-turn": ui_turn, "ui-success": ui_success, "ui-fail": ui_fail,
    "ui-crit": ui_crit,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, fn in SOUNDS.items():
            y = fn()
            wav = os.path.join(tmp, name + ".wav")
            wavfile.write(wav, SR, (y * 32767).astype(np.int16))
            ogg = os.path.join(OUT, name + ".ogg")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", ogg], check=True)
            print(f"{name}: {len(y) / SR:.2f} с, {os.path.getsize(ogg) // 1024} КБ")


if __name__ == "__main__":
    main()
