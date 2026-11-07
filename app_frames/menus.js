// Одна структура для ПКМ и трея. Действия передаются главным процессом.
const { MODES } = require('./behavior');
const EMOTIONS = [
  ['happy', 'Радость'], ['love', 'Нежность'], ['curious', 'Любопытство'],
  ['surprised', 'Удивление'], ['grumpy', 'Ворчание'], ['sad', 'Грусть'],
  ['guilty', 'Виноват'], ['laugh', 'Смех'], ['proud', 'Гордость'],
  ['party', 'Праздник'], ['scared', 'Испуг'], ['nod', 'Согласиться'], ['shake', 'Отказаться']
];
function buildMenu(state, actions) {
  const toggle = (label, key) => ({ label, type: 'checkbox', checked: state[key], click: item => actions.setFlag(key, item.checked) });
  return [
    { label: 'Поговорить с Булей', click: () => actions.openChat() },
    { label: 'Погладить', click: () => actions.play('love', 'pet') },
    { type: 'separator' },
    { label: 'Помощь', submenu: [
      { label: 'Что я умею', click: actions.help },
      { label: 'Открыть мои документы', click: actions.documents },
      { label: 'Поставить напоминание…', click: () => actions.openChat('Напомни через 10 минут ') }
    ] },
    { label: 'Поиграть', submenu: [
      { label: 'Дать лакомство', click: () => actions.play('treat', 'treat') },
      { label: 'Кинуть мячик', click: () => actions.play('ball') },
      { label: '«Служить!»', click: () => actions.play('beg') },
      { label: 'Погулять по экрану', click: actions.stroll },
      { label: 'Потянуться', click: () => actions.play('stretch') }
    ] },
    { label: 'Эмоции', submenu: EMOTIONS.map(([name, label]) => ({ label, click: () => actions.play(name) })) },
    { type: 'separator' },
    { label: 'Поведение', submenu: [
      { label: 'Активность', submenu: Object.entries(MODES).map(([id, mode]) => ({
        label: mode.label, type: 'radio', checked: state.mode === id, click: () => actions.setMode(id)
      })) },
      { type: 'separator' },
      toggle('Самостоятельные реплики', 'chatty'),
      toggle('Реакции на события', 'events'),
      toggle('Напоминать размяться', 'stretch')
    ] },
    { label: 'Внешность', submenu: [actions.skinMenu(), { label: 'Вернуть в угол', click: actions.resetPosition }] },
    { label: 'Нейросеть…', click: actions.settings },
    actions.memoryMenu(),
    { type: 'separator' },
    { label: state.visible ? 'Спрятать Булю' : 'Показать Булю', click: actions.toggleVisible },
    { label: 'Выход', click: actions.quit }
  ];
}
module.exports = { buildMenu };
