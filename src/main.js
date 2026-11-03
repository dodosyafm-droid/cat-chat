import { Application, Ticker } from 'pixi.js';
import { Live2DSprite, Config } from 'easy-live2d';

/* ---------- настройки из адреса страницы ----------
   ?debug=1        показать панель проверки (без неё страница чистая и прозрачная)
   ?mood=0.7       зафиксировать настроение (0 тихо ... 1 оживлённо), для проверки
   ?full=8         сколько сообщений в минуту считать «очень оживлённо» (по умолчанию 8)
   ?model=...      другой адрес файла модели */
const query = new URLSearchParams(location.search);
const DEBUG = query.get('debug') === '1';
const MODEL_URL = query.get('model') || './model/cat.model3.json';
const FIXED_MOOD = query.has('mood') ? parseFloat(query.get('mood')) : null;
const FULL_RATE = parseFloat(query.get('full')) > 0 ? parseFloat(query.get('full')) : 8;
/* ?gaze=1      как часто кот смотрит на чат (1 = обычно, 2 = вдвое чаще, 0.5 = вдвое реже, 0 = не смотрит)
   ?gazeTo=min  в какую сторону параметра ParamEyeBallX глаза смотрят на чат (min или max) */
const GAZE = query.has('gaze') && Number.isFinite(parseFloat(query.get('gaze'))) ? Math.max(0, parseFloat(query.get('gaze'))) : 1;
const GAZE_TO = query.get('gazeTo') === 'max' ? 1 : -1;

if (DEBUG) document.body.classList.add('debug', 'bg-check');

const logBox = document.getElementById('log');

function log(message, cls) {
    if (!DEBUG) return;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = message;
    logBox.appendChild(line);
}

if (DEBUG) {
    ['log', 'info', 'warn', 'error'].forEach(kind => {
        const orig = console[kind].bind(console);
        console[kind] = (...args) => {
            orig(...args);
            try {
                const text = args.map(x => {
                    if (x && x.message) return x.message;
                    if (typeof x === 'object') { try { return JSON.stringify(x); } catch (e) { return String(x); } }
                    return String(x);
                }).join(' ').slice(0, 300);
                log('[консоль ' + kind + '] ' + text, kind === 'error' ? 'err' : undefined);
            } catch (e) { /* ничего */ }
        };
    });

    window.addEventListener('error', e => log('Ошибка: ' + e.message, 'err'));
    window.addEventListener('unhandledrejection', e => {
        const r = e.reason;
        log('Ошибка: ' + (r && r.message ? r.message : r), 'err');
    });

    document.querySelectorAll('[data-bg]').forEach(b => {
        b.addEventListener('click', () => { document.body.className = 'debug ' + b.dataset.bg; });
    });
}

async function checkFiles() {
    log('--- проверка файлов модели ---');

    try {
        const v = Live2DCubismCore.Version;
        const n = v.csmGetVersion();
        log('Версия Cubism Core: ' + (n >>> 24) + '.' + ((n >>> 16) & 255) + '.' + (n & 65535) +
            '; самая новая версия moc3, которую он понимает: ' + v.csmGetLatestMocVersion());
    } catch (e) {
        log('Версию Core прочитать не удалось: ' + e.message);
    }

    const base = new URL(MODEL_URL, location.href);
    let json;

    try {
        const r = await fetch(base);
        log('model3.json: ' + (r.ok ? 'найден' : 'НЕ НАЙДЕН') + ' (' + r.status + ')', r.ok ? 'ok' : 'err');
        if (!r.ok) return;
        json = await r.json();
    } catch (e) {
        log('model3.json не прочитался: ' + e.message, 'err');
        return;
    }

    const refs = json.FileReferences || {};
    const files = [];

    if (refs.Moc) files.push(['moc3', refs.Moc]);
    (refs.Textures || []).forEach((f, i) => files.push(['текстура ' + i, f]));
    ['Physics', 'Pose', 'DisplayInfo', 'UserData'].forEach(k => { if (refs[k]) files.push([k, refs[k]]); });
    Object.keys(refs.Motions || {}).forEach(g => {
        (refs.Motions[g] || []).forEach((m, i) => { if (m.File) files.push(['движение ' + g + ' #' + i, m.File]); });
    });
    (refs.Expressions || []).forEach((e, i) => { if (e.File) files.push(['выражение ' + i, e.File]); });

    log('Version в model3.json: ' + json.Version);
    log('model3.json: ' + JSON.stringify(json).slice(0, 1500));

    for (const [name, file] of files) {
        try {
            const r = await fetch(new URL(file, base));
            if (!r.ok) { log(name + ': ' + file + ' — НЕТ (' + r.status + ')', 'err'); continue; }
            if (name === 'moc3') {
                const buf = new Uint8Array(await r.arrayBuffer());
                const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
                log('moc3: ' + file + ' — есть, формат ' + magic + ', версия ' + buf[4] + ', размер ' + buf.length + ' байт', 'ok');
            } else {
                log(name + ': ' + file + ' — есть', 'ok');
            }
        } catch (e) {
            log(name + ': ' + file + ' — ошибка ' + e.message, 'err');
        }
    }

    if (refs.DisplayInfo) {
        try {
            const r = await fetch(new URL(refs.DisplayInfo, base));
            const cdi = await r.json();
            const params = (cdi.Parameters || []).map(p => p.Id);
            window.__paramIds = params;
            log('Параметры модели (' + params.length + '): ' + params.join(', '));
        } catch (e) {
            log('cdi3.json не прочитался: ' + e.message, 'err');
        }
    }

    log('--- конец проверки файлов ---');
}

async function main() {

    if (!window.Live2DCubismCore) {
        log('Не найден live2dcubismcore.min.js рядом со страницей.', 'err');
        console.error('live2dcubismcore.min.js не найден');
        return;
    }
    log('Cubism Core найден.', 'ok');

    if (DEBUG) {
        try { await checkFiles(); } catch (e) { log('Проверка файлов: ' + e.message, 'err'); }
    }

    if (Config) Config.MouseFollow = false;

    /* ---------- сцена ---------- */
    const stage = document.getElementById('stage');
    const app = new Application();
    await app.init({ resizeTo: stage, backgroundAlpha: 0, antialias: true, preference: 'webgl' });
    stage.appendChild(app.canvas);
    if (typeof app.resize === 'function') app.resize();

    const sprite = new Live2DSprite({ modelPath: MODEL_URL });
    app.stage.addChild(sprite);

    /* модель квадратная (холст 4000 x 4000): вписываем квадрат по центру */
    const fit = () => {
        const bw = stage.clientWidth, bh = stage.clientHeight;
        if (bw && bh && (app.screen.width !== bw || app.screen.height !== bh)) app.renderer.resize(bw, bh);
        const w = app.screen.width, h = app.screen.height;
        const s = Math.min(w, h);
        try { sprite.setSize(s, s); } catch (e) { sprite.width = s; sprite.height = s; }
        sprite.x = (w - s) / 2;
        sprite.y = (h - s) / 2;
    };
    fit();
    window.addEventListener('resize', fit);

    /* ---------- параметры модели ---------- */
    const MAP = {
        eyeL: 'ParamEyeLOpen',
        eyeR: 'ParamEyeROpen',
        tail: 'ParamAngleX',
        ears: 'ParamBrowLForm',
        paw:  'ParamAngleY',
        gazeX: 'ParamEyeBallX'
    };

    /* если диапазон параметра не удалось прочитать из модели, берём такой */
    const FALLBACK = {
        eyeL: { min: 0,   max: 1,  def: 1 },
        eyeR: { min: 0,   max: 1,  def: 1 },
        tail: { min: -30, max: 30, def: 0 },
        ears: { min: -1,  max: 1,  def: 0 },
        paw:  { min: -30, max: 30, def: 0 },
        gazeX: { min: -1, max: 1, def: 0 }
    };

    const ranges = {};

    const readRange = key => {
        const fb = FALLBACK[key];
        try {
            const r = sprite.getParameterValueRangeById(MAP[key]);
            if (r && typeof r === 'object') {
                const num = (...names) => { for (const n of names) if (typeof r[n] === 'number') return r[n]; return undefined; };
                const min = Array.isArray(r) ? r[0] : num('min', 'minimum', 'minValue', 'minimumValue');
                const max = Array.isArray(r) ? r[1] : num('max', 'maximum', 'maxValue', 'maximumValue');
                const def = Array.isArray(r) ? r[2] : num('default', 'def', 'defaultValue');
                if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
                    return { min, max, def: Number.isFinite(def) ? def : fb.def, source: 'из модели' };
                }
            }
        } catch (e) { /* возьмём запасное */ }
        return { ...fb, source: 'запасное' };
    };

    const set = (id, v) => sprite.setParameterValueById(id, v);
    const shown = {};   /* последние значения, которые мы выставили (для панели проверки) */
    const setKey = (key, v) => { shown[key] = v; set(MAP[key], v); };

    /* значение ParamBrowLForm, при котором уши опущены (кот спит) */
    const EAR_DROOP = 1;

    /* ---------- поведение ---------- */
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp01 = v => Math.max(0, Math.min(1, v));

    const beh = {
        auto: true,
        manual: FIXED_MOOD !== null && Number.isFinite(FIXED_MOOD),
        mood: FIXED_MOOD !== null && Number.isFinite(FIXED_MOOD) ? clamp01(FIXED_MOOD) : 0.4,
        last: performance.now(),
        tailPhase: 0,
        base: 1,
        blinkStart: -1e9,
        blinkDur: 200,
        nextBlink: performance.now() + 1500,
        earStart: -1e9,
        nextEar: performance.now() + 4000,
        pawStart: -1e9,
        nextPaw: performance.now() + 9000,
        lastPawAt: -1e9,
        gaze: 0,
        gazeTarget: 0,
        gazeUntil: 0,
        nextGaze: performance.now() + 8000,
        lastGazeEnd: -1e9,
        droop: 0,
        pawPhase: 0
    };

    const times = [];   /* когда приходили сообщения чата */

    const blinkNow = () => { beh.blinkStart = performance.now(); beh.blinkDur = lerp(520, 160, beh.mood); };
    const earNow = () => { beh.earStart = performance.now(); };
    const pawNow = () => { beh.pawStart = performance.now(); beh.lastPawAt = performance.now(); };

    /* взгляд на чат: в оживлённом чате кот время от времени переводит глаза на панель */
    const GAZE_MIN_MOOD = 0.45;
    const gazeInterval = mood => lerp(55000, 18000, mood) * (0.7 + Math.random() * 0.6) / Math.max(GAZE, 0.01);

    const startGaze = now => {
        beh.gazeTarget = 1;
        beh.gazeUntil = now + 2000 + Math.random() * 2200;
        if (Math.random() < 0.5) blinkNow();
    };

    const endGaze = now => {
        beh.gazeTarget = 0;
        beh.lastGazeEnd = now;
        beh.nextGaze = now + gazeInterval(beh.mood);
        if (Math.random() < 0.5) setTimeout(blinkNow, 250);
    };

    /* новое сообщение в чате */
    const onMessage = (force) => {
        const now = performance.now();
        times.push(now);
        if (force || Math.random() < 0.5) earNow();
        if (force) setTimeout(pawNow, 250);
        else if (Math.random() < 0.15 && now - beh.lastPawAt > 8000) setTimeout(pawNow, 250);

        /* иногда кот реагирует взглядом на само сообщение */
        if (!force && GAZE > 0 && beh.mood >= 0.5 && !beh.gazeTarget && now - beh.lastGazeEnd > 10000 && Math.random() < 0.08) {
            startGaze(now);
        }
    };

    const behave = now => {

        const dt = Math.min(0.1, (now - beh.last) / 1000);
        beh.last = now;

        /* настроение по числу сообщений за последнюю минуту */
        if (!beh.manual) {
            while (times.length && now - times[0] > 60000) times.shift();
            const target = clamp01(times.length / FULL_RATE);
            beh.mood += (target - beh.mood) * Math.min(1, dt * 0.35);
        }

        const mood = beh.mood;

        /* хвост: чем оживлённее чат, тем быстрее и шире машет */
        {
            const r = ranges.tail;
            const amp = (r.max - r.min) / 2 * lerp(0.18, 0.7, mood);
            beh.tailPhase += dt * lerp(1.1, 5.0, mood);
            setKey('tail', r.def + amp * Math.sin(beh.tailPhase));
        }

        /* глаза: в тишине закрываются, в оживлённом чате почти не моргают */
        const openTarget = clamp01((mood - 0.05) / 0.5);
        beh.base += (openTarget - beh.base) * Math.min(1, dt * 2.5);

        if (now >= beh.nextBlink && beh.base > 0.3) {
            blinkNow();
            beh.nextBlink = now + lerp(2200, 7000, mood) * (0.7 + Math.random() * 0.6);
        } else if (now >= beh.nextBlink) {
            beh.nextBlink = now + 1000;
        }

        let blink = 0;
        const bp = (now - beh.blinkStart) / beh.blinkDur;
        if (bp >= 0 && bp <= 1) blink = Math.sin(Math.PI * bp);

        const open = beh.base * (1 - blink);

        ['eyeL', 'eyeR'].forEach(key => {
            const r = ranges[key];
            setKey(key, lerp(r.min, r.max, open));
        });

        /* взгляд на чат: только в оживлённом чате и только когда кот не спит */
        {
            const r = ranges.gazeX;
            const awake = beh.base > 0.6;

            if (mood < GAZE_MIN_MOOD) beh.nextGaze = Math.max(beh.nextGaze, now + 3000);

            if (GAZE > 0 && !beh.gazeTarget && awake && mood >= GAZE_MIN_MOOD && now >= beh.nextGaze) startGaze(now);
            if (beh.gazeTarget && (now >= beh.gazeUntil || !awake || GAZE <= 0)) endGaze(now);

            beh.gaze += (beh.gazeTarget - beh.gaze) * Math.min(1, dt * (beh.gazeTarget ? 6 : 4));

            const end = GAZE_TO > 0 ? r.max : r.min;
            setKey('gazeX', r.def + (end - r.def) * beh.gaze);
        }

        /* уши: во сне отпускаются (ParamBrowLForm = EAR_DROOP), при пробуждении возвращаются в норму */
        {
            const r = ranges.ears;
            const sleepTarget = 1 - openTarget;
            beh.droop += (sleepTarget - beh.droop) * Math.min(1, dt * 1.2);

            const droopVal = Math.max(r.min, Math.min(r.max, EAR_DROOP));
            const awake = 1 - beh.droop;

            let v = lerp(r.def, droopVal, beh.droop);
            v += (r.max - r.min) * 0.05 * Math.sin(now / 1500) * awake;

            if (now >= beh.nextEar) {
                if (beh.droop < 0.3) earNow();
                beh.nextEar = now + lerp(9000, 3500, mood) * (0.6 + Math.random() * 0.8);
            }

            const ep = (now - beh.earStart) / 280;
            if (ep >= 0 && ep <= 1) v += (r.max - r.def) * 0.9 * Math.sin(Math.PI * ep) * awake;

            setKey('ears', Math.max(r.min, Math.min(r.max, v)));
        }

        /* лапа: качается как маятник (быстрее при оживлённом чате) и иногда делает взмах */
        {
            const r = ranges.paw;
            const half = (r.max - r.min) / 2;

            beh.pawPhase += dt * lerp(0.8, 2.8, mood);
            let v = r.def + half * lerp(0.12, 0.4, mood) * Math.sin(beh.pawPhase);

            if (now >= beh.nextPaw) {
                pawNow();
                beh.nextPaw = now + lerp(14000, 5000, mood) * (0.7 + Math.random() * 0.6);
            }

            const pp = (now - beh.pawStart) / 1600;
            if (pp >= 0 && pp <= 1) v += half * 0.5 * Math.sin(2 * Math.PI * 3 * pp) * (1 - pp);

            setKey('paw', Math.max(r.min, Math.min(r.max, v)));
        }
    };

    /* ---------- ручная проверка параметра (только в режиме ?debug=1) ---------- */
    const pSelect = document.getElementById('p-id');

    if (DEBUG) {
        (window.__paramIds || []).forEach(id => {
            const o = document.createElement('option');
            o.value = id; o.textContent = id;
            pSelect.appendChild(o);
        });
    }

    let ready = false;
    let behReported = false;

    Ticker.shared.add(() => {
        if (!ready) return;
        try {
            if (beh.auto) behave(performance.now());

            if (DEBUG && document.getElementById('p-hold').checked && pSelect.value) {
                const v = parseFloat(document.getElementById('p-val').value);
                if (!Number.isNaN(v)) set(pSelect.value, v);
            }
        } catch (e) {
            if (!behReported) { behReported = true; log('Ошибка в поведении: ' + e.message, 'err'); }
        }
    });

    /* ---------- запуск, когда модель готова ---------- */
    const start = () => {
        Object.keys(MAP).forEach(key => { ranges[key] = readRange(key); });
        fit();
        ready = true;
        log('Кот готов. Диапазоны: ' + Object.keys(ranges).map(k => MAP[k] + ' ' + ranges[k].min + '…' + ranges[k].max + ' (' + ranges[k].source + ')').join('; '), 'ok');
    };

    if (sprite.ready && typeof sprite.ready.then === 'function') {
        sprite.ready.then(start).catch(e => { log('Модель не запустилась: ' + (e && e.message ? e.message : e), 'err'); console.error(e); });
    } else {
        start();
    }

    /* ---------- управление снаружи (из виджета чата) ----------
       window.postMessage({type: 'message'})   новое сообщение
       window.postMessage({type: 'mood', value: 0.8})   задать настроение
       window.postMessage({type: 'blink'|'ear'|'paw'})  разовое действие */
    window.addEventListener('message', e => {
        const d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'message') onMessage(false);
        else if (d.type === 'mood' && Number.isFinite(d.value)) { beh.manual = true; beh.mood = clamp01(d.value); }
        else if (d.type === 'auto-mood') beh.manual = false;
        else if (d.type === 'blink') blinkNow();
        else if (d.type === 'ear') earNow();
        else if (d.type === 'paw') pawNow();
        else if (d.type === 'gaze') startGaze(performance.now());
    });

    window.cat = { message: () => onMessage(true), blink: blinkNow, ear: earNow, paw: pawNow, gaze: () => startGaze(performance.now()), beh };

    /* ---------- панель проверки ---------- */
    if (DEBUG) {
        const moodInput = document.getElementById('mood');
        const moodManual = document.getElementById('mood-manual');
        const moodNow = document.getElementById('mood-now');

        moodManual.checked = beh.manual;
        moodInput.value = beh.mood;

        moodManual.addEventListener('change', () => { beh.manual = moodManual.checked; });
        moodInput.addEventListener('input', () => { beh.manual = true; moodManual.checked = true; beh.mood = parseFloat(moodInput.value); });
        document.getElementById('auto').addEventListener('change', e => { beh.auto = e.target.checked; });
        document.getElementById('b-blink').addEventListener('click', blinkNow);
        document.getElementById('b-ear').addEventListener('click', earNow);
        document.getElementById('b-paw').addEventListener('click', pawNow);
        document.getElementById('b-gaze').addEventListener('click', () => startGaze(performance.now()));
        document.getElementById('b-msg').addEventListener('click', () => onMessage(true));

        setInterval(() => {
            const f = k => (shown[k] === undefined ? '-' : shown[k].toFixed(2));
            moodNow.textContent = 'сейчас: ' + beh.mood.toFixed(2) + ', сообщений за минуту: ' + times.length +
                '. Значения: хвост ' + f('tail') + ', уши ' + f('ears') + ', лапа ' + f('paw') + ', глаз ' + f('eyeL') + ', взгляд ' + f('gazeX');
            if (!moodManual.checked) moodInput.value = beh.mood;
        }, 300);

        document.getElementById('ranges').addEventListener('click', () => {
            log('--- параметры, которыми управляет кот ---');
            Object.keys(MAP).forEach(key => {
                const r = ranges[key];
                if (!r) { log(MAP[key] + ': ещё не готово', 'err'); return; }
                log(MAP[key] + ' (' + key + '): ' + r.min + ' … ' + r.max + ', по умолчанию ' + r.def + ' [' + r.source + ']');
            });
        });
    }
}

main().catch(e => log('Ошибка: ' + (e && e.message ? e.message : e), 'err'));
