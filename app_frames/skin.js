const K = window.skin, $ = id => document.getElementById(id);
const dark = $('dark'), light = $('light');
const imgs = {};

async function load(name) {
  const im = new Image(); im.src = await K.sprite(name); await im.decode(); return im;
}
function draw() {
  const pal = { dark: dark.value, light: light.value };
  for (const [id, name] of [['p1', 'idle'], ['p2', 'happy']]) {
    if (!imgs[name]) continue;
    const c = BulyaSkins.recolor(imgs[name], pal), g = $(id).getContext('2d');
    g.clearRect(0, 0, 400, 400); g.drawImage(c, 0, 0);
  }
}
let t; const redraw = () => { clearTimeout(t); t = setTimeout(draw, 40); };
dark.oninput = redraw; light.oninput = redraw;

(async () => {
  imgs.idle = await load('idle'); imgs.happy = await load('happy');
  const cur = await K.get();
  const P = BulyaSkins.PRESETS;
  if (cur.key === 'custom') { dark.value = cur.dark; light.value = cur.light; }
  else if (P[cur.key] && P[cur.key].dark) { dark.value = P[cur.key].dark; light.value = P[cur.key].light; }
  for (const [k, p] of Object.entries(P)) {
    if (!p.dark) continue;
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<i class="sw" style="background:${p.dark}"></i><i class="sw" style="background:${p.light}"></i>`;
    b.appendChild(document.createTextNode(p.title));
    b.onclick = () => { dark.value = p.dark; light.value = p.light; draw(); };
    $('presets').appendChild(b);
  }
  draw();
})();

$('apply').onclick = async () => { await K.save({ key: 'custom', dark: dark.value, light: light.value }); window.close(); };
$('classic').onclick = async () => { await K.save({ key: 'classic' }); window.close(); };
$('cancel').onclick = () => window.close();
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
