// Компьютер: состояние, скриншот, звук и музыка, блокировка, Параметры
const { shell, desktopCapturer, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ps, bulyaDir } = require('./_util');

const SETTINGS = ['display', 'sound', 'network', 'network-wifi', 'bluetooth', 'windowsupdate', 'storagesense', 'appsfeatures',
  'defaultapps', 'personalization', 'personalization-background', 'privacy', 'batterysaver', 'printers', 'mousetouchpad',
  'keyboard', 'dateandtime', 'regionlanguage', 'notifications', 'powersleep', 'about'];

// виртуальные медиаклавиши Windows
const KEYS = { play_pause: 179, next: 176, previous: 177, volume_up: 175, volume_down: 174, mute: 173 };
const press = (code, times = 1) => ps(`$w = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $w.SendKeys([char]${code}) }`);

async function cpuLoad() {
  const snap = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const a = snap(); await new Promise(r => setTimeout(r, 700)); const b = snap();
  return Math.round(100 * (1 - (b.idle - a.idle) / Math.max(1, b.total - a.total)));
}
const parseList = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [v]; } catch { return []; } };

module.exports = [
  {
    name: 'system_info', label: 'Обнюхиваю компьютер', anim: 'search',
    description: 'Состояние компьютера: загрузка процессора, память, диски, батарея, время работы, самые тяжёлые программы.',
    async run() {
      const [cpu, disks, procs, battery] = await Promise.all([
        cpuLoad(),
        ps("Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Used -ne $null} | Select-Object Name,@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json -Compress").catch(() => '[]'),
        ps("Get-Process | Sort-Object WS -Descending | Select-Object -First 8 Name,@{n='MemoryMB';e={[int]($_.WS/1MB)}},@{n='CpuSec';e={[int]$_.CPU}} | ConvertTo-Json -Compress").catch(() => '[]'),
        ps("Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress").catch(() => '')
      ]);
      return {
        ok: true, cpu_percent: cpu, cpu_model: os.cpus()[0]?.model, cores: os.cpus().length,
        ram_total_gb: +(os.totalmem() / 2 ** 30).toFixed(1), ram_free_gb: +(os.freemem() / 2 ** 30).toFixed(1),
        uptime_hours: +(os.uptime() / 3600).toFixed(1), windows: os.release(),
        disks: parseList(disks), heaviest_programs: parseList(procs), battery: battery.trim() ? parseList(battery)[0] : 'нет батареи (стационарный ПК)'
      };
    }
  },
  {
    name: 'screenshot', label: 'Фоткаю экран', anim: 'work', doneAnim: 'happy',
    description: 'Сделать скриншот экрана и сохранить в Документы\\Буля\\Скриншоты. Буля на время прячется, чтобы не попасть в кадр.',
    parameters: { type: 'object', properties: { open: { type: 'boolean', description: 'открыть картинку после сохранения (по умолчанию да)' } } },
    async run({ open = true }, { win }) {
      const d = screen.getPrimaryDisplay();
      const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
      const wasVisible = win && win.isVisible();
      if (wasVisible) { win.hide(); await new Promise(r => setTimeout(r, 300)); }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
        const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const file = path.join(bulyaDir('Скриншоты'), `Скриншот ${stamp}.png`);
        fs.writeFileSync(file, src.thumbnail.toPNG());
        if (open) shell.openPath(file);
        return { ok: true, saved: file };
      } finally { if (wasVisible) win.showInactive(); }
    }
  },
  {
    name: 'media_control', label: 'Нажимаю кнопки', anim: 'work', doneAnim: 'wag',
    description: 'Управление музыкой/видео и громкостью через медиаклавиши Windows: пауза/продолжить, следующий, предыдущий, громче, тише, без звука, установить громкость в процентах.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'volume_up', 'volume_down', 'mute', 'set_volume'] },
      steps: { type: 'number', description: 'для volume_up/down: сколько шагов по 2% (по умолчанию 5)' },
      percent: { type: 'number', description: 'для set_volume: 0–100' } }, required: ['action'] },
    async run({ action, steps = 5, percent }) {
      if (action === 'set_volume') {
        const p = Math.max(0, Math.min(100, Number(percent)));
        if (!Number.isFinite(p)) return { ok: false, error: 'Нужен процент 0–100' };
        await press(KEYS.volume_down, 50);
        if (p > 0) await press(KEYS.volume_up, Math.round(p / 2));
        return { ok: true, volume_percent: Math.round(p / 2) * 2 };
      }
      if (!KEYS[action]) return { ok: false, error: 'Не знаю такую кнопку' };
      const n = /volume_(up|down)/.test(action) ? Math.max(1, Math.min(50, Math.round(steps))) : 1;
      await press(KEYS[action], n);
      return { ok: true, pressed: action, times: n };
    }
  },
  {
    name: 'lock_screen', label: 'Закрываю экран на замок', anim: 'work',
    description: 'Заблокировать компьютер (экран входа Windows). Только если хозяин прямо попросил.',
    async run() { spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
  },
  {
    name: 'open_settings', label: 'Открываю Параметры', anim: 'work',
    description: 'Открыть нужный раздел Параметров Windows (настройки меняет сам хозяин).',
    parameters: { type: 'object', properties: { page: { type: 'string', enum: SETTINGS } }, required: ['page'] },
    async run({ page }) {
      if (!SETTINGS.includes(page)) return { ok: false, error: 'Неизвестный раздел' };
      await shell.openExternal('ms-settings:' + page); return { ok: true };
    }
  }
];
