// Загрузчик умений Були. Каждый файл в папке skills/ экспортирует массив умений:
// { name, description, parameters, label, anim, doneAnim?, confirm?(args) -> текст вопроса, run(args, ctx) }
//   label    — что пишет Буля в статусе («Ищу на YouTube»)
//   anim     — анимация, пока умение работает (search | work | think | ...)
//   doneAnim — короткая реакция после успеха (happy | wag | love | ...)
//   confirm  — если задан, перед запуском хозяин видит окно «Разрешить / Отмена»
//   unmask   — локальное действие: метки [[телефон_1]] заменяются настоящими данными только здесь, на компьютере
//   private  — результат может содержать личное: перед отправкой на сервер он проходит через фильтр
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { hideHomeDeep, expandHomeDeep } = require('./privacy');

const SKILLS = {};
for (const file of fs.readdirSync(path.join(__dirname, 'skills')).sort()) {
  if (!file.endsWith('.js') || file.startsWith('_')) continue;
  for (const s of require(path.join(__dirname, 'skills', file))) {
    if (SKILLS[s.name]) throw new Error('Умение с именем ' + s.name + ' уже есть');
    SKILLS[s.name] = { anim: 'work', label: 'Работаю', ...s, file };
  }
}

const TOOL_SCHEMAS = Object.values(SKILLS).map(s => ({
  type: 'function',
  function: { name: s.name, description: s.description, parameters: s.parameters || { type: 'object', properties: {} } }
}));

function getSkill(name) { return SKILLS[name]; }

async function runTool(name, args, ctx) {
  const s = SKILLS[name];
  if (!s) return { ok: false, error: 'Нет такого умения' };
  if (s.confirm) {
    const q = s.confirm(args || {});
    if (q) {
      const r = await dialog.showMessageBox(ctx.win, {
        type: 'question', buttons: ['Разрешить', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Буля спрашивает разрешения', message: q.message || String(q), detail: q.detail || ''
      });
      if (r.response !== 0) return { ok: false, error: 'Хозяин не разрешил' };
    }
  }
  // unmask: в локальные действия (документ, буфер, заметка) подставляем настоящие данные вместо меток [[...]]
  // %USERPROFILE% (так сервер видит папку хозяина) -> настоящий путь
  let a = expandHomeDeep(args || {});
  if (s.unmask && ctx.secrets) a = ctx.secrets.unmaskDeep(a);
  let res = await s.run(a, ctx);
  // пути с именем хозяина на сервер не уходят
  res = hideHomeDeep(res);
  // всё, что уходит обратно на сервер из файлов/буфера/документов, — через фильтр личных данных
  if ((s.private || s.unmask) && ctx.secrets) {
    const found = [];
    res = ctx.secrets.maskDeep(res, found);
    if (found.length && s.private && ctx.onEvent) ctx.onEvent({ type: 'privacy', labels: [...new Set(found)], where: s.label });
  }
  return res;
}

module.exports = { TOOL_SCHEMAS, runTool, getSkill, SKILLS };
