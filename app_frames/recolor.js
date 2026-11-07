// Перекраска Були: тёмная шерсть -> цвет «голова», светлая -> цвет «тело».
// Контур, белая обводка стикера и цветные детали (язык, сердечки, подушечки, лупа) не трогаем.
(function (root) {
  const PRESETS = {
    classic:   { title: 'Классика (как Буля)', dark: null, light: null },
    fawn:      { title: 'Палевый', dark: '#2B2320', light: '#DDB07A' },
    blue:      { title: 'Голубой', dark: '#58677A', light: '#E6EAEF' },
    cream:     { title: 'Кремовый', dark: '#B88D66', light: '#F7EBDD' },
    chocolate: { title: 'Шоколадный', dark: '#4E3226', light: '#EADBCB' },
    space:     { title: 'Космос', dark: '#3A2C78', light: '#FFE27A', outline: '#1B1240' }
  };
  const hex = h => { h = String(h || '').replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };

  // img -> canvas с перекрашенным Булей
  function recolor(img, pal) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    if (!pal || !pal.dark || !pal.light) return c;
    const im = g.getImageData(0, 0, w, h), d = im.data, N = w * h;
    const lum = new Float32Array(N), body = new Uint8Array(N), colored = new Uint8Array(N), light = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
      lum[i] = (r + gg + b) / 3;
      body[i] = a > 30 ? 1 : 0;
      colored[i] = (Math.max(r, gg, b) - Math.min(r, gg, b)) > 35 ? 1 : 0;
      light[i] = body[i] && lum[i] >= 150 && !colored[i] ? 1 : 0;
    }
    // расстояние до прозрачного (BFS) — край силуэта
    const dist = new Int32Array(N).fill(1e9), q = new Int32Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (!body[i]) { dist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0, nd = dist[i] + 1;
      if (x > 0 && dist[i - 1] > nd) { dist[i - 1] = nd; q[qt++] = i - 1; }
      if (x < w - 1 && dist[i + 1] > nd) { dist[i + 1] = nd; q[qt++] = i + 1; }
      if (y > 0 && dist[i - w] > nd) { dist[i - w] = nd; q[qt++] = i - w; }
      if (y < h - 1 && dist[i + w] > nd) { dist[i + w] = nd; q[qt++] = i + w; }
    }
    // обводка стикера = светлая полоса у края силуэта. Ширину меряем в каждом кадре:
    // контур (тёмное) начинается на этом расстоянии от края, белая шерсть лежит глубже.
    const darkD = [];
    for (let i = 0; i < N; i++) if (body[i] && lum[i] < 80 && !colored[i]) darkD.push(dist[i]);
    darkD.sort((a, b) => a - b);
    const bw = darkD.length ? darkD[Math.floor(darkD.length * 0.03)] : Math.round(w / 400 * 13);
    const border = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (light[i] && dist[i] < bw) border[i] = 1;
    const D = hex(pal.dark), L = hex(pal.light), O = pal.outline ? hex(pal.outline) : null;
    for (let i = 0; i < N; i++) {
      if (!body[i] || colored[i]) continue;
      const l = lum[i], o = i * 4;
      if (light[i] && !border[i]) {
        const k = Math.min(1.05, Math.max(0.6, l / 246));
        d[o] = Math.min(255, L[0] * k); d[o + 1] = Math.min(255, L[1] * k); d[o + 2] = Math.min(255, L[2] * k);
      } else if (l >= 34 && l < 150) {
        const k = Math.min(1.9, Math.max(0.55, l / 62)), add = Math.max(0, k - 1) * 40;
        d[o] = Math.min(255, D[0] * k + add); d[o + 1] = Math.min(255, D[1] * k + add); d[o + 2] = Math.min(255, D[2] * k + add);
      } else if (O && l < 34) {
        const k = 0.6 + l / 34 * 0.4;
        d[o] = O[0] * k; d[o + 1] = O[1] * k; d[o + 2] = O[2] * k;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }
  root.BulyaSkins = { PRESETS, recolor };
})(window);
