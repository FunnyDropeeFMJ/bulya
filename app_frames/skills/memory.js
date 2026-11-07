// Память и сейф. Личные данные (метки [[...]]) в память не попадают — только в зашифрованный сейф.
const { dialog } = require('electron');

module.exports = [
  {
    name: 'remember', label: 'Запоминаю', anim: 'think', doneAnim: 'love',
    description: 'Запомнить о хозяине что-то устойчивое и интересное: факт («водит Nissan Almera N16»), предпочтение («любит короткие ответы») или забавный момент («в 3 ночи искал рецепт блинов»). Пиши коротко, одно предложение, от третьего лица. НЕ запоминай здоровье, деньги/доходы, интимное, политику/религию, данные других людей и любые метки [[...]].',
    parameters: { type: 'object', properties: {
      kind: { type: 'string', enum: ['факт', 'предпочтение', 'момент'] },
      text: { type: 'string' } }, required: ['kind', 'text'] },
    async run({ kind, text }, { memory, secrets }) {
      if (/\[\[/.test(text)) return { ok: false, error: 'Личные данные храню только в сейфе, не в памяти' };
      const m = secrets.mask(String(text));
      if (m.found.length) return { ok: false, error: 'Тут личные данные (' + m.found.join(', ') + ') — в память не пишу' };
      return memory.add(['факт', 'предпочтение', 'момент'].includes(kind) ? kind : 'факт', text);
    }
  },
  {
    name: 'recall', label: 'Вспоминаю', anim: 'think',
    description: 'Поискать в памяти всё, что связано с темой (например, «что я говорил про машину»). Пустой запрос — последние записи.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    async run({ query }, { memory }) { const r = memory.search(query || '', 15); return { ok: true, found: r.length, items: r }; }
  },
  {
    name: 'forget_memory', label: 'Забываю', anim: 'guilty',
    description: 'Забыть из памяти всё, что относится к теме, когда хозяин просит «забудь …».',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'о чём забыть' } }, required: ['query'] },
    async run({ query }, { memory, win }) {
      const list = memory.forgetPreview(query);
      if (!list.length) return { ok: false, error: 'Ничего подходящего не нашёл (или запрос слишком короткий)' };
      // больше одной записи — спрашиваем хозяина, чтобы случайно не стереть лишнее
      if (list.length > 1) {
        const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Забыть', 'Отмена'], defaultId: 1, cancelId: 1, noLink: true,
          title: 'Буля спрашивает разрешения', message: `Забыть ${list.length} записей?`, detail: list.slice(0, 12).map(t => '• ' + t).join('\n') + (list.length > 12 ? '\n…' : '') });
        if (r.response !== 0) return { ok: false, error: 'Хозяин передумал' };
      }
      const removed = memory.forget(query);
      return { ok: true, removed_count: removed.length, removed };
    }
  },
  {
    name: 'no_tease', label: 'Понял, больше не шучу про это', anim: 'guilty',
    description: 'Хозяин попросил не шутить/не подкалывать на какую-то тему — добавить её в табу.',
    parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    async run({ topic }, { memory }) { return { ok: memory.addTaboo(topic), taboo: memory.d.табу }; }
  },
  {
    name: 'vault_save', label: 'Прячу в сейф', anim: 'work', doneAnim: 'happy',
    description: 'Положить личные данные хозяина в зашифрованный сейф на компьютере (паспорт, адрес, телефон, ИНН…). value — это метка из сообщения хозяина, например [[паспорт_1]]: настоящее значение подставится на компьютере, сервер его не увидит.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'короткое имя: паспорт, адрес, телефон, инн' },
      value: { type: 'string', description: 'метка вида [[телефон_1]] или текст' } }, required: ['name', 'value'] },
    async run({ name, value }, { memory, secrets }) {
      const real = secrets.unmask(String(value || ''));
      if (!real.trim() || /\[\[/.test(real)) return { ok: false, error: 'Не вижу, что прятать. Хозяин может написать сам: «сейф: имя = значение»' };
      const k = memory.vaultSet(name, real);
      return k ? { ok: true, saved_as: k, use_in_documents: `[[сейф:${k}]]` } : { ok: false, error: 'Не получилось' };
    }
  },
  {
    name: 'vault_list', label: 'Заглядываю в сейф', anim: 'search',
    description: 'Какие данные лежат в сейфе (только названия, без значений).',
    async run(_, { memory }) { return { ok: true, names: memory.vaultNames() }; }
  },
  {
    name: 'vault_forget', label: 'Убираю из сейфа', anim: 'work',
    description: 'Убрать запись из сейфа (с подтверждением хозяина).',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    confirm: ({ name }) => ({ message: `Убрать «${name}» из сейфа Були?`, detail: 'Данные будут удалены с компьютера.' }),
    async run({ name }, { memory }) { return memory.vaultDel(name) ? { ok: true } : { ok: false, error: 'Такого в сейфе нет' }; }
  }
];
