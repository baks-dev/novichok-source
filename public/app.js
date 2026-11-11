'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { employees: [], today: '', priority: 'all', selectedId: null, loaded: false, refreshing: false };
  const questions = [
    ['clarity', 'Понятно ли вам, что нужно делать?', 'Задачи понятны'],
    ['tools', 'Есть ли у вас все инструменты и доступы?', 'Инструменты есть'],
    ['support', 'Знаете ли вы, к кому обратиться за помощью?', 'Поддержка есть']
  ];
  const levels = ['urgent', 'attention', 'ok'];
  const moodNames = { good: 'Хорошо', neutral: 'Нейтрально', bad: 'Сложно' };
  let toastTimer;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function button(text, className, handler) {
    const node = el('button', className, text);
    node.type = 'button';
    if (handler) node.addEventListener('click', handler);
    return node;
  }
  function array(value) { return Array.isArray(value) ? value : []; }
  function text(value, fallback = 'Не указано') { return value == null || value === '' ? fallback : String(value); }
  function date(value, withTime = false) {
    if (!value) return 'Нет даты';
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    if (Number.isNaN(parsed.getTime())) return 'Нет даты';
    return parsed.toLocaleString('ru-RU', withTime
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function day(employee) { return Math.max(0, Math.floor(Number(employee.day) || 0)); }
  function level(employee) { return levels.includes(employee.priority?.level) ? employee.priority.level : 'unknown'; }
  function pending(employee) { return array(employee.actions).filter(action => !action.completedAt); }
  function initials(name) { return text(name, '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase(); }
  function sorted(items, key) { return [...array(items)].sort((a, b) => (Date.parse(b[key]) || 0) - (Date.parse(a[key]) || 0)); }
  function showError(node, message) { node.textContent = message; node.hidden = !message; }
  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', signal: controller.signal
      });
      let data;
      try { data = await response.json(); } catch { throw new Error(`Сервер вернул некорректный ответ (HTTP ${response.status}).`); }
      if (!response.ok || data?.error) throw new Error(text(data?.error, `Ошибка сервера: HTTP ${response.status}.`));
      if (body !== undefined && data?.ok !== true) throw new Error('Сервер не подтвердил сохранение. Обновите данные перед повторной отправкой.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сервер не ответил вовремя. Если вы отправляли форму, обновите данные перед повторной отправкой: изменения могли сохраниться.');
      if (error instanceof TypeError) throw new Error('Не удалось связаться с сервером. Проверьте соединение. Перед повторной отправкой формы обновите данные.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async function refresh() {
    if (state.refreshing) return false;
    state.refreshing = true;
    $('#refresh').disabled = true;
    $('#refresh').textContent = 'Обновление…';
    $('#employee-list').setAttribute('aria-busy', 'true');
    showError($('#global-error'), '');
    try {
      const data = await request('/api/dashboard');
      if (!data || !Array.isArray(data.employees) || !data.employees.every(employee => employee && employee.id != null)) {
        throw new Error('Не удалось прочитать список сотрудников: неверный формат данных API.');
      }
      state.employees = data.employees;
      state.today = data.today;
      state.loaded = true;
      $('#today').textContent = date(state.today);
      updateSelectors();
      renderSummary();
      renderList();
      if ($('#employee-dialog').open) renderDetail();
      return true;
    } catch (error) {
      showError($('#global-error'), `${error.message}${state.loaded ? ' Ниже показаны последние загруженные данные.' : ' Нажмите «Обновить», чтобы повторить загрузку.'}`);
      if (!state.loaded) $('#employee-list').replaceChildren(el('div', 'empty', 'Пока не удалось загрузить команду. Для работы нужен доступ к API.'));
      return false;
    } finally {
      state.refreshing = false;
      $('#refresh').disabled = false;
      $('#refresh').textContent = '↻ Обновить';
      $('#loading').hidden = true;
      $('#employee-list').setAttribute('aria-busy', 'false');
      $('#checkin-submit').disabled = !state.loaded || !state.employees.length;
    }
  }

  function updateSelectors() {
    const department = $('#department');
    const previousDepartment = department.value;
    department.replaceChildren(new Option('Все подразделения', ''));
    const departments = [...new Set(state.employees.map(employee => text(employee.department, '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    departments.forEach(value => department.add(new Option(value, value)));
    if (departments.includes(previousDepartment)) department.value = previousDepartment;
    const respondent = $('#respondent');
    const previousEmployee = respondent.value;
    respondent.replaceChildren(new Option('Выберите сотрудника', ''));
    [...state.employees].sort((a, b) => text(a.name).localeCompare(text(b.name), 'ru')).forEach(employee => {
      respondent.add(new Option(`${text(employee.name)} · ${text(employee.department, 'Без подразделения')}`, String(employee.id)));
    });
    if (state.employees.some(employee => String(employee.id) === previousEmployee)) respondent.value = previousEmployee;
    updateRespondentInfo();
  }

  function renderSummary() {
    const employees = state.employees;
    const cards = [
      ['В адаптации', employees.length, 'сотрудников в вашей команде', '', '↗'],
      ['Нужна помощь', employees.filter(employee => level(employee) === 'urgent').length, 'важно связаться в первую очередь', 'urgent', '!'],
      ['Обратить внимание', employees.filter(employee => level(employee) === 'attention').length, 'не оставляйте без разговора', 'attention', '◷'],
      ['Без сигналов', employees.filter(employee => level(employee) === 'ok').length, 'продолжайте поддерживать', 'ok', '✓']
    ];
    $('#summary').replaceChildren(...cards.map(([label, number, foot, cls, icon]) => {
      const node = el('article', `stat ${cls}`);
      node.append(el('span', 'stat-icon', icon), el('div', 'stat-label', label), el('div', 'stat-number', number), el('div', 'stat-foot', foot));
      return node;
    }));
  }

  function priorityBadge(employee) {
    const priority = level(employee);
    const badge = el('span', `badge ${priority}`);
    badge.append(el('i', `dot ${priority}`), document.createTextNode(text(employee.priority?.label, 'Приоритет не определён')));
    return badge;
  }
  function renderList() {
    const query = $('#search').value.trim().toLocaleLowerCase('ru');
    const department = $('#department').value;
    const employees = state.employees.filter(employee =>
      (!query || `${text(employee.name, '')} ${text(employee.role, '')}`.toLocaleLowerCase('ru').includes(query)) &&
      (!department || String(employee.department) === department) &&
      (state.priority === 'all' || level(employee) === state.priority)
    ).sort((a, b) => {
      const rank = { urgent: 0, attention: 1, unknown: 2, ok: 3 };
      return rank[level(a)] - rank[level(b)] || text(a.name).localeCompare(text(b.name), 'ru');
    });
    $('#team-count').textContent = `${employees.length} / ${state.employees.length}`;
    $('#employee-list').replaceChildren(...employees.map(employee => {
      const card = el('article', 'employee-card');
      const person = el('div', 'person');
      const details = el('div');
      details.append(el('h3', 'person-name', text(employee.name)), el('div', 'person-role', `${text(employee.role)} · ${text(employee.department)}`));
      person.append(el('div', 'person-avatar', initials
(employee.name)), details);
      const progress = el('div', 'progress-block');
      const title = el('div', 'progress-title');
      title.append(el('strong', '', `День ${day(employee)}`), el('span', '', 'из 90'));
      const track = el('div', 'progress-track');
      const fill = el('div', 'progress-fill');
      fill.style.width = `${Math.min(100, day(employee) / 90 * 100)}%`;
      track.append(fill);
      progress.append(title, track, el('div', 'progress-foot', `Старт ${date(employee.startDate)}`));
      const status = el('div');
      const reasons = array(employee.priority?.reasons);
      status.append(priorityBadge(employee), el('p', 'status-note', reasons.length ? reasons.join(' · ') : `${pending(employee).length} открытых задач помощи`));
      const open = button('Карточка ↗', 'open-card', () => openDetail(employee.id));
      open.setAttribute('aria-label', `Открыть карточку: ${text(employee.name)}`);
      card.append(person, progress, status, open);
      return card;
    }));
    if (!employees.length) $('#employee-list').append(el('div', 'empty', state.employees.length ? 'Никого не нашли. Попробуйте другой запрос или измените фильтры.' : 'В команде пока нет сотрудников. Они появятся здесь после добавления в системе.'));
  }

  function setMode(mode) {
    const manager = mode === 'manager';
    $('#manager-view').hidden = !manager;
    $('#employee-view').hidden = manager;
    $('#manager-mode').classList.toggle('active', manager);
    $('#employee-mode').classList.toggle('active', !manager);
    $('#manager-mode').setAttribute('aria-pressed', String(manager));
    $('#employee-mode').setAttribute('aria-pressed', String(!manager));
    $('#breadcrumb').textContent = manager ? 'Обзор' : 'Ответ новичка';
  }
  function updateRespondentInfo() {
    const employee = state.employees.find(item => String(item.id) === $('#respondent').value);
    $('#respondent-info').textContent = employee ? `День ${day(employee)} · ${text(employee.role)} · Руководитель: ${text(employee.manager)}` : '';
  }
  function makeField(label, tag, name, options = {}) {
    const wrapper = el('label', 'field', label);
    const input = el(tag);
    input.name = name;
    Object.assign(input, options);
    wrapper.append(input);
    return { wrapper, input };
  }
  function makeQuestions() {
    $('#checkin-questions').replaceChildren(...questions.map(([name, question]) => {
      const fieldset = el('fieldset');
      const legend = el('legend', '', `${question} `);
      legend.append(el('span', 'required', '*'));
      const choices = el('div', 'yes-no');
      [['true', 'Да'], ['false', 'Нет']].forEach(([value, label]) => {
        const option = el('label');
        const input = el('input');
        Object.assign(input, { type: 'radio', name, value, required: true });
        option.append(input, document.createTextNode(label));
        choices.append(option);
      });
      fieldset.append(legend, choices);
      return fieldset;
    }));
  }

  function openDetail(id) {
    state.selectedId = String(id);
    renderDetail();
    $('#employee-dialog').showModal();
  }
  function renderDetail() {
    const employee = state.employees.find(item => String(item.id) === state.selectedId);
    const root = $('#detail-content');
    root.replaceChildren();
    if (!employee) {
      root.append(el('h2', '', 'Сотрудник не найден'), el('p', 'muted', 'Возможно, список изменился. Закройте карточку и выберите другого сотрудника.'));
      return;
    }
    const heading = el('div', 'detail-heading');
    const headingText = el('div');
    const title = el('h2', '', text(employee.name));
    title.id = 'detail-title';
    headingText.append(title, el('div', 'muted', `${text(employee.role)} · ${text(employee.department)}`));
    heading.append(el('div', 'person-avatar', initials(employee.name)), headingText);
    const meta = el('div', 'detail-meta');
    meta.append(el('span', '', `Руководитель: ${text(employee.manager)}`), el('span', '', `Бадди: ${text(employee.buddy)}`), el('span', '', `Дата старта: ${date(employee.startDate)}`), el('span', '', `День ${day(employee)} из 90`));
    root.append(heading, meta, priorityBadge(employee));
    if (array(employee.priority?.reasons).length) {
      const reasons = el('ul', 'reasons');
      employee.priority.reasons.forEach(reason => reasons.append(el('li', '', reason)));
      root.append(reasons);
    }
    const copy = button('Копировать для Битрикс24 ↗', 'button secondary', () => copyEmployee(employee, copyError));
    const copyError = el('div', 'message error');
    copyError.hidden = true;
    copyError.setAttribute('role', 'alert');
    root.append(el('p', 'form-footnote', 'Интеграции с Битрикс24 нет. Скопируйте текст и вручную вставьте его в задачу или комментарий.'), copy, copyError);
    const actionsSection = el('section', 'detail-section');
    actionsSection.append(el('h3', '', `Помощь и договорённости · ${pending(employee).length} открыто`));
    const actions = [...array(employee.actions)].sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    if (!actions.length) actionsSection.append(el('p', 'muted', 'Пока нет договорённостей. Зафиксируйте первый шаг помощи ниже.'));
    actions.forEach(action => actionsSection.append(renderAction(action)));
    actionsSection.append(makeActionForm(employee));
    root.append(actionsSection);
    const history = el('section', 'detail-section');
    history.append(el('h3', '', `История ответов · ${array(employee.checkins).length}`));
    if (!array(employee.checkins).length) history.append(el('p', 'muted', 'Ответов пока нет. Предложите новичку заполнить короткую форму.'));
    sorted(employee.checkins, 'createdAt').forEach(checkin => {
      const item = el('article', 'history-item');
      const head = el('div', 'item-head');
      head.append(el('span', '', moodNames[checkin.mood] || 'Настроение не указано'), el('span', 'muted', date(checkin.createdAt, true)));
      const tags = el('div', 'answer-tags');
      questions.forEach(([name, , label]) => tags.append(el('span', `answer-tag ${checkin[name] === false ? 'negative' : ''}`, `${label}: ${checkin[name] === true ? 'да' : checkin[name] === false ? 'нет' : 'нет ответа'}`)));
      item.append(head, tags);
      if (checkin.comment) item.append(el('p', 'user-text', checkin.comment));
      history.append(item);
    });
    const respond = button('Перейти к ответу новичка', 'button secondary', () => {
      $('#employee-dialog').close();
      setMode('employee');
      $('#respondent').value = String(employee.id);
      updateRespondentInfo();
      $('#respondent').focus();
    });
    root.append(history, respond);
  }

  async function saveForm(form, path, payload, errorNode, success, onSaved) {
    const submit = $('button[type="submit"]', form);
    if (submit.disabled) return;
    showError(errorNode, '');
    const controls = [...form.elements];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    const original = submit.textContent;
    submit.textContent = 'Сохранение…';
    let saved = false;
    try {
      await request(path, payload);
      saved = true;
      onSaved?.();
      toast(success);
      const refreshed = await refresh();
      if (!refreshed) {
        toast(`${success} Список не обновился — нажмите «Обновить».`);
        if (path.includes('/actions/') && $('#employee-dialog').open) $('#employee-dialog').close();
      }
    } catch (error) { showError(errorNode, error.message); }
    finally {
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      submit.textContent = original;
      if (saved && path.includes('/actions/') && path.endsWith('/complete')) submit.disabled = true;
    }
  }

  function makeActionForm(employee) {
    const form = el('form', 'action-form');
    form.append(el('h4', '', 'Новая помощь'));
    const action = makeField('Что нужно сделать *', 'textarea', 'text', { required: true, maxLength: 500, rows: 2, placeholder: 'Например, вместе настроить доступ к CRM' });
    const owner = makeField('Кто поможет *', 'input', 'owner', { required: true, maxLength: 100, placeholder: 'Имя ответственного' });
    const due = makeField('Срок *', 'input', 'dueDate', { type: 'date', required: true });
    due.input.min = state.today;
        owner.input.value = employee.manager;
        const row = el('div', 'form-row');
    row.append(owner.wrapper, due.wrapper);
    const error = el('div', 'message error');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const submit = button('Создать помощь +', 'button primary');
    submit.type = 'submit';
    form.append(action.wrapper, row, error, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const payload = { text: action.input.value.trim(), owner: owner.input.value.trim(), dueDate: due.input.value };
      if (!payload.text || !payload.owner) return showError(error, 'Опишите помощь и укажите ответственного. Пробелы не считаются ответом.');
      saveForm(form, `/api/employees/${encodeURIComponent(employee.id)}/actions`, payload, error, 'Помощь создана.', () => form.reset());
    });
    return form;
  }

  function renderAction(action) {
    const item = el('article', `action-item ${action.completedAt ? 'completed' : ''}`);
    item.append(el('div', 'action-title', text(action.text)), el('div', 'muted', `Ответственный: ${text(action.owner)} · Срок: ${date(action.dueDate)}`), el('div', 'muted', `Создано: ${date(action.createdAt, true)}`));
    if (action.completedAt) {
      item.append(el('div', 'muted', `✓ Закрыто: ${date(action.completedAt, true)}`), el('p', 'user-text', `Результат: ${text(action.result)}`));
      return item;
    }
    const form = el('form', 'completion-form');
    form.hidden = true;
    const result = makeField('Чем закончилась помощь? *', 'textarea', 'result', { required: true, maxLength: 1000, rows: 2, placeholder: 'Опишите конкретный результат' });
    const error = el('div', 'message error');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const submit = button('Сохранить результат и закрыть', 'button primary');
    submit.type = 'submit';
    const toggle = button('Зафиксировать результат', 'button secondary', () => {
      form.hidden = !form.hidden;
      toggle.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) result.input.focus();
    });
    toggle.setAttribute('aria-expanded', 'false');
    form.append(result.wrapper, error, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = result.input.value.trim();
      if (!value) return showError(error, 'Укажите результат: без него помощь нельзя закрыть.');
      saveForm(form, `/api/actions/${encodeURIComponent(action.id)}/complete`, { result: value }, error, 'Результат сохранён. Помощь закрыта.');
    });
    const buttons = el('div', 'action-buttons');
    buttons.append(toggle);
    item.append(buttons, form);
    return item;
  }

  function exportEmployee(employee) {
    const lines = [
      'НОВИЧОК / Первые 90 дней',
      `${text(employee.name)} — ${text(employee.role)}`,
      `Подразделение: ${text(employee.department)}`,
      `Руководитель: ${text(employee.manager)}; бадди: ${text(employee.buddy)}`,
      `Старт: ${date(employee.startDate)}; день ${day(employee)} из 90`,
      `Приоритет: ${text(employee.priority?.label, 'Не определён')}`,
      ...array(employee.priority?.reasons).map(reason => `• ${reason}`), '', 'ПОМОЩЬ И ДОГОВОРЁННОСТИ'
    ];
    if (!array(employee.actions).length) lines.push('Пока нет.');
    array(employee.actions).forEach(action => {
      lines.push(`${action.completedAt ? '[Закрыто]' : '[Открыто]'} ${text(action.text)}`, `Ответственный: ${text(action.owner)}; срок: ${date(action.dueDate)}`);
      if (action.completedAt) lines.push(`Результат: ${text(action.result)}; закрыто ${date(action.completedAt, true)}`);
    });
    lines.push('', 'ИСТОРИЯ ОТВЕТОВ');
    if (!array(employee.checkins).length) lines.push('Ответов пока нет.');
    sorted(employee.checkins, 'createdAt').forEach(checkin => {
      lines.push(`${date(checkin.createdAt, true)} — ${moodNames[checkin.mood] || 'Нет настроения'}`);
      questions.forEach(([key, , label]) => lines.push(`${label}: ${checkin[key] === true ? 'да' : checkin[key] === false ? 'нет' : 'нет ответа'}`));
      if (checkin.comment) lines.push(`Комментарий: ${checkin.comment}`);
    });
    lines.push('', 'Текст для ручного переноса в Битрикс24. Автоматическая отправка не выполнялась.');
    return lines.join('\n');
  }
  async function copyEmployee(employee, error) {
    showError(error, '');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(exportEmployee(employee));
      toast('Текст скопирован. Вставьте его в Битрикс24 вручную.');
    } catch {
      showError(error, 'Браузер не разрешил копирование. Выделите текст ниже и скопируйте вручную.');
      let area = $('textarea', error);
      if (!area) {
        area = el('textarea');
        area.readOnly = true;
        area.rows = 8;
        area.style.width = '100%';
        area.setAttribute('aria-label', 'Текст для ручного переноса в Битрикс24');
        error.append(area);
      }
      area.value = exportEmployee(employee);
      area.focus();
      area.select();
    }
  }

  $('#manager-mode').addEventListener('click', () => setMode('manager'));
  $('#employee-mode').addEventListener('click', () => setMode('employee'));
  $('#refresh').addEventListener('click', refresh);
  $('#search').addEventListener('input', () => { if (state.loaded) renderList(); });
  $('#department').addEventListener('change', () => { if (state.loaded) renderList(); });
  $('.priority-filters').addEventListener('click', event => {
    const filter = event.target.closest('[data-priority]');
    if (!filter) return;
    state.priority = filter.dataset.priority;
    document.querySelectorAll('[data-priority]').forEach(node => {
      node.classList.toggle('active', node === filter);
      node.setAttribute('aria-pressed', String(node === filter));
    });
    if (state.loaded) renderList();
  });
  $('#respondent').addEventListener('change', () => {
    const id = $('#respondent').value;
    $('#checkin-form').reset();
    $('#respondent').value = id;
    updateRespondentInfo();
    showError($('#checkin-error'), '');
  });
  $('#close-dialog').addEventListener('click', () => $('#employee-dialog').close());
  $('#employee-dialog').addEventListener('click', event => {
    if (event.target !== $('#employee-dialog')) return;
    const bounds = event.target.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close();
  });
  $('#checkin-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = $('#respondent').value;
    if (!id || !state.employees.some(employee => String(employee.id) === id)) return showError($('#checkin-error'), 'Выберите сотрудника из списка.');
    if (!['good', 'neutral', 'bad'].includes(data.get('mood')) || questions.some(([key]) => !['true', 'false'].includes(data.get(key)))) {
      return showError($('#checkin-error'), 'Выберите настроение и ответьте «да» или «нет» на каждый вопрос.');
    }
    const payload = { mood: data.get('mood'), clarity: data.get('clarity') === 'true', tools: data.get('tools') === 'true', support: data.get('support') === 'true', comment: String(data.get('comment') || '').trim() };
    saveForm(form, `/api/employees/${encodeURIComponent(id)}/checkins`, payload, $('#checkin-error'), 'Спасибо! Ваш ответ сохранён.', () => { form.reset(); $('#respondent').value = id; updateRespondentInfo(); });
  });
  makeQuestions();
  $('#checkin-submit').disabled = true;
  refresh();
})();
