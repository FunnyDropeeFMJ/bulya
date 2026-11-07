// Документы: Word с нуля, заполнение шаблона Word, таблица Excel. Всё сохраняется НОВЫМИ файлами в Документы\Буля.
const { shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { bulyaDir, safeName, uniquePath, inUserFolders } = require('./_util');

// **жирный** внутри строки
function runs(text, TextRun, extra = {}) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(part =>
    part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true, ...extra }) : new TextRun({ text: part, ...extra }));
}

async function buildDocx(title, content) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
  const children = [];
  if (title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(title)] }));
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { children.push(new Paragraph({ text: '' })); continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)/))) children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(m[1], TextRun) }));
    else if ((m = line.match(/^##\s+(.*)/))) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(m[1], TextRun) }));
    else if ((m = line.match(/^#\s+(.*)/))) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(m[1], TextRun) }));
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) children.push(new Paragraph({ bullet: { level: 0 }, children: runs(m[1], TextRun) }));
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) children.push(new Paragraph({ numbering: { reference: 'num', level: 0 }, children: runs(m[1], TextRun) }));
    else if ((m = line.match(/^>>\s*(.*)/))) children.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: runs(m[1], TextRun) }));
    else children.push(new Paragraph({ spacing: { after: 120 }, children: runs(line, TextRun) }));
  }
  const doc = new Document({
    creator: 'Буля',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 28 } } } },
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } }, children }]
  });
  return await Packer.toBuffer(doc);
}

module.exports = [
  {
    name: 'create_word_document', unmask: true, label: 'Пишу документ в Word', anim: 'work', doneAnim: 'happy',
    description: 'Создать НОВЫЙ документ Word (.docx) и открыть его. Текст пишешь ты сам. Разметка content: "# Заголовок", "## Подзаголовок", "- пункт списка", "1. нумерованный пункт", ">> текст справа" (для шапки заявления), **жирный**. Сохраняется в Документы\\Буля.',
    parameters: { type: 'object', properties: {
      file_name: { type: 'string', description: 'имя файла без расширения' },
      title: { type: 'string', description: 'заголовок по центру (можно пусто)' },
      content: { type: 'string', description: 'текст документа с разметкой' },
      open: { type: 'boolean', description: 'открыть в Word (по умолчанию да)' } }, required: ['file_name', 'content'] },
    async run({ file_name, title, content, open = true }) {
      const file = uniquePath(bulyaDir(), safeName(file_name), '.docx');
      fs.writeFileSync(file, await buildDocx(title, content));
      if (open) shell.openPath(file);
      return { ok: true, saved: file };
    }
  },
  {
    name: 'fill_word_template', unmask: true, label: 'Заполняю шаблон', anim: 'work', doneAnim: 'happy',
    description: 'Заполнить шаблон Word (.docx), где поля помечены фигурными скобками, например {ФИО}, {дата}. Сначала можно прочитать шаблон через read_file, чтобы узнать поля. Результат — НОВЫЙ файл в Документы\\Буля, шаблон не меняется.',
    parameters: { type: 'object', properties: {
      template_path: { type: 'string', description: 'полный путь к шаблону .docx' },
      values: { type: 'array', description: 'значения полей', items: { type: 'object', properties: { field: { type: 'string', description: 'имя поля без скобок, например ФИО' }, value: { type: 'string' } }, required: ['field', 'value'] } },
      file_name: { type: 'string', description: 'имя нового файла без расширения' },
      open: { type: 'boolean' } }, required: ['template_path', 'values'] },
    async run({ template_path, values, file_name, open = true }) {
      if (!inUserFolders(template_path) || !/\.docx$/i.test(template_path)) return { ok: false, error: 'Нужен шаблон .docx из папок пользователя' };
      if (!fs.existsSync(template_path)) return { ok: false, error: 'Шаблон не найден' };
      const PizZip = require('pizzip'); const Docxtemplater = require('docxtemplater');
      const doc = new Docxtemplater(new PizZip(fs.readFileSync(template_path)), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
      const data = {}; for (const v of (Array.isArray(values) ? values : [])) if (v && v.field) data[String(v.field).replace(/[{}]/g, '').trim()] = String(v.value ?? '');
      if (values && !Array.isArray(values) && typeof values === 'object') Object.assign(data, values);
      try { doc.render(data); }
      catch (e) { return { ok: false, error: 'Шаблон сломан: ' + (e.properties && e.properties.errors ? e.properties.errors.map(x => x.properties.explanation).join('; ') : e.message) }; }
      const name = safeName(file_name || path.basename(template_path, '.docx') + ' — заполнено');
      const file = uniquePath(bulyaDir(), name, '.docx');
      fs.writeFileSync(file, doc.getZip().generate({ type: 'nodebuffer' }));
      if (open) shell.openPath(file);
      return { ok: true, saved: file };
    }
  },
  {
    name: 'create_excel', unmask: true, label: 'Делаю таблицу в Excel', anim: 'work', doneAnim: 'happy',
    description: 'Создать НОВУЮ таблицу Excel (.xlsx) и открыть её. Первая строка каждого листа — заголовки. Числа передавай числами. Формулы — строкой, начинающейся с "=", например "=SUM(B2:B10)". Сохраняется в Документы\\Буля.',
    parameters: { type: 'object', properties: {
      file_name: { type: 'string' },
      sheets: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' },
        rows: { type: 'array', description: 'строки таблицы; каждая строка — массив ячеек (текстом: числа тоже можно строкой, они станут числами)', items: { type: 'array', items: { type: 'string' } } } }, required: ['rows'] } },
      open: { type: 'boolean' } }, required: ['file_name', 'sheets'] },
    async run({ file_name, sheets, open = true }) {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook(); wb.creator = 'Буля';
      (sheets || []).forEach((sh, i) => {
        const ws = wb.addWorksheet(safeName(sh.name || `Лист${i + 1}`).slice(0, 31));
        (sh.rows || []).forEach(r => ws.addRow((r || []).map(v => {
          if (typeof v !== 'string') return v;
          const s = v.trim();
          if (s.startsWith('=')) return { formula: s.slice(1) };
          const c = s.replace(/\s/g, '');
          if (/^-?\d+([.,]\d+)?$/.test(c) && !/^-?0\d/.test(c) && c.replace(/\D/g, '').length <= 10) return Number(s.replace(/\s/g, '').replace(',', '.'));
          return v;
        })));
        if (ws.rowCount) {
          ws.getRow(1).font = { bold: true };
          ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2E6C9' } };
          ws.views = [{ state: 'frozen', ySplit: 1 }];
        }
        ws.columns.forEach(col => {
          let max = 8; col.eachCell({ includeEmpty: false }, c => { max = Math.max(max, String(c.value && c.value.formula ? '' : c.value ?? '').length + 2); });
          col.width = Math.min(60, max);
        });
      });
      const file = uniquePath(bulyaDir(), safeName(file_name), '.xlsx');
      await wb.xlsx.writeFile(file);
      if (open) shell.openPath(file);
      return { ok: true, saved: file };
    }
  }
];
