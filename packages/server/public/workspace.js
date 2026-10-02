import { icon, hydrateIcons } from './icons.js';
hydrateIcons(document);
const $ = (selector) => document.querySelector(selector);
const state = {
  csrf: null,
  session: null,
  projects: [],
  records: [],
  documents: [],
  locales: [],
  project: null,
  selected: null,
  checked: new Set(),
  cursor: null,
  imported: [],
  busy: false,
  dirty: false,
  view: 'overview',
  summary: null,
  operations: null,
  providerAccounts: null,
  batch: false,
  integration: 'cli',
};
const can = (scope) => state.session?.scopes.includes(scope);
function askDecision({ title, message, accept = 'Continue', reason = false }) {
  const dialog = $('#decision-dialog');
  if (dialog.open) return Promise.resolve(null);
  $('#decision-title').textContent = title;
  $('#decision-message').textContent = message;
  $('#decision-accept').textContent = accept;
  $('#decision-reason-field').hidden = !reason;
  $('#decision-reason').required = reason;
  $('#decision-reason').value = '';
  dialog
    .querySelectorAll('button, input, select, textarea')
    .forEach((control) => (control.disabled = false));
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(
          dialog.returnValue === 'accept' ? (reason ? $('#decision-reason').value : true) : null,
        );
      },
      { once: true },
    );
    dialog.showModal();
    (reason ? $('#decision-reason') : dialog.querySelector('[value="cancel"]')).focus();
  });
}
async function discardCorrections() {
  if (
    state.dirty &&
    !(await askDecision({
      title: 'Unsaved corrections',
      message: 'Discard your unsaved corrections?',
      accept: 'Discard corrections',
    }))
  )
    return false;
  state.dirty = false;
  return true;
}

const names = new Proxy(
  {},
  {
    get: (labels, locale) =>
      state.locales.find((item) => item.id === locale)?.label ??
      new Intl.DisplayNames([locale], { type: 'language' }).of(locale),
  },
);
const statuses = {
  pending: 'Queued',
  running: 'Translating',
  review: 'Needs review',
  failed: 'Failed',
  stale: 'Source changed',
  approved: 'Approved',
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function nativeLanguage(locale, tag = 'bdi') {
  const node = element(tag, names[locale]);
  node.lang = locale;
  node.dir = 'auto';
  return node;
}
function actionButton(text, className, name = 'arrow-right', leading = false) {
  const button = element('button', undefined, className);
  const label = document.createTextNode(text);
  button.append(...(leading ? [icon(name), label] : [label, icon(name)]));
  return button;
}
function notify(message, error = false) {
  const node = $('#message');
  node.textContent = message;
  node.className = error ? 'error' : '';
  node.hidden = false;
  const dialog = document.querySelector('dialog[open]');
  if (error && dialog) {
    let status = dialog.querySelector('[data-dialog-status]');
    if (!status) {
      status = element('p', undefined, 'dialog-error');
      status.dataset.dialogStatus = '';
      status.setAttribute('role', 'alert');
      dialog.querySelector('h2').after(status);
    }
    status.textContent = message;
  }
  node.setAttribute('role', error ? 'alert' : 'status');
  const dismiss = actionButton('', 'message-dismiss', 'close');
  dismiss.setAttribute('aria-label', 'Dismiss notification');
  dismiss.addEventListener('click', () => (node.hidden = true));
  node.append(dismiss);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(state.csrf ? { 'x-csrf-token': state.csrf } : {}),
      ...(method === 'POST' && path.endsWith('/jobs')
        ? { 'idempotency-key': crypto.randomUUID() }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) showLogin();
    const fieldLabels = {
      name: 'project name',
      sourceLocale: 'original language',
      targetLocales: 'target languages',
      budgetUsd: 'translation budget',
      approvalMode: 'approval mode',
      glossary: 'terminology',
      instructions: 'language guidance',
    };
    const fields = [
      ...new Set(
        (data.error?.fields ?? []).map((field) => fieldLabels[field.split('.')[0]] ?? field),
      ),
    ];
    throw new Error(
      fields.length
        ? 'Check the following fields and try again: ' + fields.join(', ') + '.'
        : (data.error?.message ?? 'The request could not be completed'),
    );
  }
  return data;
}
const path = (suffix) => `/projects/${encodeURIComponent(state.project.id)}${suffix}`;
function showLogin() {
  $('#login').hidden = false;
  $('#workspace').hidden = true;
  $('#logout').hidden = true;
}
async function guarded(action) {
  if (state.busy) return;
  state.busy = true;
  document.querySelectorAll('[data-dialog-status]').forEach((node) => node.remove());
  $('#main').setAttribute('aria-busy', 'true');
  const buttons = [...document.querySelectorAll('button, input, select, textarea')].map((node) => ({
    node,
    disabled: node.disabled,
  }));
  buttons.forEach((x) => (x.node.disabled = true));
  try {
    await action();
  } catch (error) {
    notify(error.message, true);
  } finally {
    state.busy = false;
    $('#main').removeAttribute('aria-busy');
    buttons.forEach((x) => {
      if (x.node.isConnected) x.node.disabled = x.disabled;
    });
    updateBatch();
    applyActionAvailability();
  }
}
function localeLabel(locale) {
  const wrapper = element('div', undefined, 'locale-label');
  const definition = state.locales.find((item) => item.id === locale);
  if (definition?.flag) {
    const flag = element('img', undefined, 'flag');
    flag.src = '/assets/flags/' + definition.flag + '.svg';
    flag.alt = '';
    wrapper.append(flag);
  }
  const copy = element('div');
  copy.append(nativeLanguage(locale, 'strong'), element('small', locale));
  wrapper.append(copy);
  return wrapper;
}
async function showView(view, focus = true) {
  if (state.view === view) return;
  if (state.busy || !(await discardCorrections())) return;
  renderView(view, focus);
}
function renderView(view, focus = true) {
  state.view = view;
  for (const name of ['overview', 'review', 'content', 'connect'])
    $('#view-' + name).hidden = name !== view;
  for (const button of document.querySelectorAll('[data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#message').hidden = true;
  if (focus) $('#main').focus();
}
document
  .querySelectorAll('[data-view]')
  .forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$('#overview-connect').addEventListener('click', () => showView('connect'));
$('#start-review').addEventListener('click', async () => {
  if (!state.project) return projectDialog(false);
  if (!state.summary?.sourceUnits) return showView('content');
  const locale =
    state.summary.languages.find((item) => item.review)?.locale ?? state.project.targetLocales[0];
  if (locale) {
    $('#language').value = locale;
    $('#status').value = 'review';
    await guarded(() => refresh());
  }
  await showView('review');
});
async function projects() {
  state.projects = await api('/projects');
  const current = state.project?.id;
  $('#project').replaceChildren(
    ...state.projects.map((project) => {
      const option = element('option', project.name);
      option.value = project.id;
      return option;
    }),
  );
  state.project = state.projects.find((item) => item.id === current) ?? state.projects[0] ?? null;
  if (state.project) {
    $('#project').value = state.project.id;
    await selectProject();
  } else {
    state.records = [];
    state.documents = [];
    state.summary = null;
    state.selected = null;
    renderOverview();
    renderRows();
    renderDetail();
    renderContent();
    renderIntegration();
  }
}
async function selectProject() {
  $('#message').hidden = true;
  state.selected = null;
  state.dirty = false;
  state.checked.clear();
  state.imported = [];
  state.documents = await api(path('/documents'));
  const choices = state.documents.map((document) => {
    const option = element('option', document.namespace);
    option.value = document.namespace;
    return option;
  });
  const first = element('option', 'Choose imported content');
  first.value = '';
  $('#document').replaceChildren(first, ...choices);
  for (const id of ['language', 'content-language', 'export-language']) {
    const existing = $('#' + id).value;
    $('#' + id).replaceChildren(
      ...state.project.targetLocales.map((locale) => {
        const option = nativeLanguage(locale, 'option');
        option.value = locale;
        return option;
      }),
    );
    if (state.project.targetLocales.includes(existing)) $('#' + id).value = existing;
  }
  await refresh();
  renderContent();
  renderIntegration();
}
function applyActionAvailability() {
  $('#translate').disabled =
    !state.project ||
    !state.imported.length ||
    !$('#content-language').value ||
    !state.session?.providersReady;
  $('#export').disabled = !state.project || !$('#export-language').value;
  $('#versions').disabled = !state.project || !$('#export-language').value;
  $('#preview-document').disabled = !state.imported.length || !$('#content-language').value;
  $('#download-document').disabled = !state.imported.length || !$('#content-language').value;
  $('#settings').disabled = !state.project;
  $('#tokens').disabled = !state.project;
  $('#batch-mode').hidden = !can('approve');
}
async function refresh(append = false) {
  if (!state.project) return;
  const filters = {
    language: $('#language').value,
    status: $('#status').value,
    search: $('#search').value,
  };
  const params = new URLSearchParams({
    limit: '100',
    current: $('#status').value === 'stale' ? 'false' : 'true',
  });
  if ($('#language').value) params.set('locale', $('#language').value);
  if ($('#status').value) params.set('status', $('#status').value);
  if ($('#search').value.trim()) params.set('search', $('#search').value.trim());
  if (append && state.cursor) params.set('cursor', state.cursor);
  const [allProjects, data, summary, operations, providerAccounts] = await Promise.all([
    api('/projects'),
    api(path('/jobs?' + params)),
    api(path('/summary')),
    state.session?.owner ? api('/operations') : Promise.resolve(null),
    state.session?.owner ? api('/chatgpt/accounts') : Promise.resolve(null),
  ]);
  state.projects = allProjects;
  state.project = allProjects.find((project) => project.id === state.project.id) ?? state.project;
  state.summary = summary;
  state.operations = operations;
  state.providerAccounts = providerAccounts;
  renderProviderAccounts();
  state.filters = filters;
  $('#budget').textContent =
    '$' +
    state.project.spentUsd.toFixed(3) +
    ' spent · $' +
    state.project.reservedUsd.toFixed(3) +
    ' reserved · $' +
    state.project.budgetUsd.toFixed(2) +
    ' project limit';
  state.records = append ? [...state.records, ...data.records] : data.records;
  state.cursor = data.cursor;
  $('#load-more').hidden = !state.cursor;
  if (state.selected)
    state.selected = state.records.find((item) => item.id === state.selected.id) ?? null;
  for (const id of state.checked)
    if (!state.records.some((job) => job.id === id && job.status === 'review'))
      state.checked.delete(id);
  renderOverview();
  renderRows();
  if (!state.dirty) renderDetail();
  applyActionAvailability();
}
function renderOverview() {
  const summary = state.summary;
  const languages = summary?.languages ?? [];
  const review = languages.reduce((sum, language) => sum + language.review, 0);
  const approved = languages.reduce((sum, language) => sum + language.approved, 0);
  $('#review-count').textContent = review;
  $('#review-count').hidden = !review;
  $('#overview-description').textContent = !state.project
    ? 'Create your first project, then bring the content you want to translate.'
    : review
      ? review + ' translations are ready for your attention. Take them one language at a time.'
      : summary?.sourceUnits
        ? 'Your current content, at a glance. Pick a language to see what’s next.'
        : 'Start with a catalog or article. We’ll keep its structure intact.';
  const nextAction = !state.project
    ? 'Create your first project'
    : !summary?.sourceUnits
      ? 'Add your first content'
      : review
        ? 'Start reviewing'
        : 'Open review';
  $('#start-review').replaceChildren(document.createTextNode(nextAction), icon('arrow-right'));
  $('#overview-stats').replaceChildren(
    ...[
      [summary?.sourceUnits ?? 0, 'Source segments', 'file'],
      [review, 'Ready for review', 'review'],
      [approved, 'Approved translations', 'check'],
    ].map(([count, label, name]) => {
      const stat = element('div', undefined, 'stat');
      const header = element('div', undefined, 'stat-heading');
      header.append(element('span', label), icon(name));
      stat.append(header, element('strong', count));
      return stat;
    }),
  );
  const policy = $('#approval-policy');
  policy.hidden = !state.project;
  const automatic = state.project?.approvalMode === 'automatic';
  const policyCopy = element('div');
  policyCopy.append(
    element('strong', automatic ? 'Automatic approval is on' : 'Human review gate is on'),
    element(
      'p',
      automatic
        ? 'Clean translations become exportable after validation and AI review. Material issues come here for attention.'
        : 'AI prepares and checks each translation. You approve the exact wording before it reaches an export.',
    ),
  );
  policy.replaceChildren(icon(automatic ? 'refresh' : 'shield'), policyCopy);
  const operations = $('#operations-notice');
  const service = state.operations?.projects.find((project) => project.id === state.project?.id);
  const dead = state.operations?.delivery.dead ?? 0;
  const stalled = service?.oldestPendingAt && Date.now() - service.oldestPendingAt > 900000;
  operations.hidden = !(service?.failed || dead || stalled);
  if (!operations.hidden) {
    const copy = element('div');
    const heading = element('h2', 'Some work needs attention');
    heading.id = 'operations-title';
    copy.append(
      heading,
      element(
        'p',
        `${service?.failed ?? 0} failed translations. ${dead} notifications need a delivery retry.${stalled ? ' Some translations have been queued for more than 15 minutes.' : ''}`,
      ),
    );
    const open = actionButton('View failed translations', 'text-button', 'arrow-right');
    open.addEventListener('click', () =>
      guarded(async () => {
        $('#status').value = 'failed';
        $('#language').value = '';
        await refresh();
        await showView('review');
      }),
    );
    copy.append(open);
    if (dead && state.session?.owner) {
      const retry = actionButton('Retry failed notifications', 'text-button', 'refresh');
      retry.addEventListener('click', () =>
        guarded(async () => {
          const events = (state.operations?.events ?? []).filter(
            (event) => event.status === 'dead',
          );
          for (const event of events)
            await api('/deliveries/' + encodeURIComponent(event.id) + '/retry', 'POST', {});
          await refresh();
          notify(`${events.length} notifications queued for another delivery attempt.`);
        }),
      );
      copy.append(retry);
    }
    operations.replaceChildren(icon('shield'), copy);
  }
  $('#provider-notice').textContent = state.session?.providersReady
    ? automatic
      ? 'Clean AI-reviewed revisions are approved automatically. You can inspect or correct them at any time.'
      : 'Translations follow your human review gate before export.'
    : 'Configure generation and review providers on the server to enable translation.';
  $('#source-description').replaceChildren(
    ...(state.project ? ['Original: ', nativeLanguage(state.project.sourceLocale)] : []),
  );
  const container = $('#language-coverage');
  container.replaceChildren();
  for (const language of languages) {
    const row = element('div', undefined, 'language-row'),
      coverage = element('div', undefined, 'coverage'),
      progress = element('progress');
    progress.max = Math.max(language.total, 1);
    progress.value = language.approved;
    progress.setAttribute('aria-label', names[language.locale] + ' approved coverage');
    coverage.append(
      progress,
      element('p', language.approved + ' of ' + language.total + ' approved', 'coverage-label'),
    );
    const status = element(
      'p',
      language.review
        ? language.review + ' ready for review'
        : language.failed
          ? language.failed + ' need attention'
          : language.working
            ? language.working + ' in progress'
            : language.untranslated
              ? language.untranslated + ' to translate'
              : language.total
                ? 'Up to date'
                : 'Waiting for content',
      'language-state',
    );
    const open = actionButton(language.review ? 'Review' : 'Open', 'text-button');
    open.setAttribute(
      'aria-label',
      (language.review ? 'Review ' : 'Open ') + names[language.locale],
    );
    open.addEventListener('click', async () => {
      if (state.busy || !(await discardCorrections())) return;
      $('#language').value = language.locale;
      $('#status').value = language.review ? 'review' : '';
      $('#search').value = '';
      state.selected = null;
      await guarded(() => refresh());
      await showView('review');
    });
    row.append(localeLabel(language.locale), coverage, status, open);
    container.append(row);
  }
  if (!languages.length) {
    const empty = element('div', undefined, 'empty-state');
    empty.append(
      element(
        'h2',
        state.project
          ? 'Choose the languages you want to reach.'
          : 'Everything starts with a project.',
      ),
      element(
        'p',
        state.project
          ? 'Add a target language in project settings. Your originals always stay available.'
          : 'Keep your content, languages, budget, and approvals together.',
      ),
    );
    container.append(empty);
  }
}
function updateBatch() {
  $('#batch-bar').hidden = !state.batch;
  $('#batch-count').textContent = state.checked.size + ' selected';
  $('#batch-approve').disabled = !state.checked.size;
  $('#batch-mode').textContent = state.batch ? 'Done selecting' : 'Select several';
}
function displaySource(value, context) {
  return /^(HTML sentence inside |(?:markdown|mdx) (?:paragraph|heading|tableCell)$)/.test(
    context ?? '',
  )
    ? value.replace(/\[\[EL:[a-f0-9]+:\d+\]\]/g, '')
    : value;
}
function renderRows() {
  $('#rows').replaceChildren();
  $('#empty').hidden = state.records.length > 0;
  for (const job of state.records) {
    const row = element(
      'div',
      undefined,
      'queue-item' + (state.selected?.id === job.id ? ' selected' : ''),
    );
    if (state.batch) {
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.checked.has(job.id);
      checkbox.disabled = job.status !== 'review';
      checkbox.setAttribute('aria-label', 'Select ' + job.source.source.slice(0, 60));
      checkbox.addEventListener('change', () => {
        checkbox.checked ? state.checked.add(job.id) : state.checked.delete(job.id);
        updateBatch();
      });
      const selection = element('label', undefined, 'queue-selection');
      selection.append(checkbox);
      row.append(selection);
    }
    const button = element('button', undefined, 'source-button');
    if (state.selected?.id === job.id) button.setAttribute('aria-current', 'true');
    button.append(
      element('span', displaySource(job.source.source, job.source.context), 'queue-copy'),
    );
    const meta = element('span', undefined, 'queue-meta');
    meta.append(
      element('span', job.source.context || 'Message', 'small'),
      element('span', statuses[job.status], 'badge ' + job.status),
    );
    button.append(meta);
    button.addEventListener('click', async () => {
      if (state.busy || !(await discardCorrections())) return;
      state.selected = job;
      renderRows();
      renderDetail();
      if (matchMedia('(max-width:800px)').matches) $('#detail-heading')?.focus();
    });
    row.append(button);
    $('#rows').append(row);
  }
  updateBatch();
}
function renderDetail() {
  const job = state.selected,
    panel = $('#detail');
  panel.replaceChildren();
  $('#review-layout').classList.toggle('has-selection', Boolean(job));
  if (!job) {
    const empty = element('div', undefined, 'empty-state');
    empty.append(
      element(
        'h2',
        state.records.length ? 'A little attention goes a long way.' : 'Nothing to review here.',
      ),
      element(
        'p',
        state.records.length
          ? 'Choose a translation. Compare its meaning, refine the wording, and approve when it feels right.'
          : 'Choose another language or status to see more translations.',
      ),
    );
    panel.append(empty);
    return;
  }
  const header = element('div', undefined, 'detail-header'),
    back = actionButton('Back to translations', 'text-button review-back', 'arrow-left', true);
  back.addEventListener('click', async () => {
    if (!(await discardCorrections())) return;
    state.selected = null;
    renderRows();
    renderDetail();
    $('#search').focus();
  });
  const top = element('div', undefined, 'detail-top'),
    heading = nativeLanguage(job.locale, 'h2');
  heading.id = 'detail-heading';
  heading.tabIndex = -1;
  top.append(heading, element('span', statuses[job.status], 'badge ' + job.status));
  header.append(
    back,
    top,
    element('p', job.source.context || 'Check the meaning, details, and terminology.', 'context'),
  );
  const body = element('div', undefined, 'detail-body'),
    comparison = element('div', undefined, 'comparison'),
    original = element('div'),
    target = element('div'),
    label = element('label', 'Translation');
  const originalLabel = element('label', 'Original · ');
  originalLabel.append(nativeLanguage(job.source.sourceLocale));
  const source = element(
    'div',
    displaySource(job.source.source, job.source.context),
    'source-copy',
  );
  source.lang = job.source.sourceLocale;
  source.dir = 'auto';
  original.append(originalLabel, source);
  label.htmlFor = 'translation';
  const editor = element('textarea', undefined, 'translation-copy');
  editor.id = 'translation';
  editor.value = job.translation ?? '';
  editor.dir = state.locales.find((item) => item.id === job.locale)?.direction ?? 'auto';
  editor.lang = job.locale;
  editor.disabled = !['review', 'approved'].includes(job.status) || !can('review');
  editor.rows = Math.min(12, Math.max(3, Math.ceil(editor.value.length / 70)));
  editor.spellcheck = true;
  target.append(label, editor);
  comparison.append(original, target);
  body.append(comparison);
  const findings = element('div', undefined, 'findings');
  if (job.error) findings.append(element('div', job.error, 'finding critical'));
  if (!job.findings.length)
    findings.append(
      element(
        'p',
        ['review', 'approved'].includes(job.status)
          ? 'No issues flagged by automated checks'
          : 'Review is not complete yet.',
        ['review', 'approved'].includes(job.status) ? 'review-clear' : 'small',
      ),
    );
  for (const finding of job.findings)
    findings.append(element('div', finding.message, 'finding ' + finding.severity));
  body.append(findings);
  if (job.reviewSummary) {
    const notes = element('details');
    notes.append(element('summary', 'AI review notes'), element('p', job.reviewSummary));
    body.append(notes);
  }
  const previewDetails = element('details');
  previewDetails.append(
    element('summary', job.source.kind === 'icu' ? 'Preview with example values' : 'Text preview'),
  );
  const preview = element('div', editor.value, 'example-preview');
  preview.dir = editor.dir;
  preview.lang = job.locale;
  const inputs = element('div', undefined, 'example-inputs');
  previewDetails.append(inputs, preview);
  let previewLoaded = false;
  const updatePreview = async () => {
    if (job.source.kind !== 'icu') {
      preview.textContent = editor.value;
      return;
    }
    try {
      const values = Object.fromEntries(
        [...inputs.querySelectorAll('input')].map((input) => [
          input.name,
          input.type === 'number' ? Number(input.value) : input.value,
        ]),
      );
      const result = await api(path('/preview'), 'POST', {
        locale: job.locale,
        message: editor.value,
        values,
      });
      preview.textContent = result.text;
      if (!previewLoaded) {
        for (const argument of result.arguments) {
          const field = element('div'),
            label = element('label', argument.name),
            input = element('input');
          input.id = 'example-' + inputs.children.length;
          input.name = argument.name;
          input.type = argument.type === 'number' ? 'number' : 'text';
          input.value = argument.value;
          label.htmlFor = input.id;
          field.append(label, input);
          inputs.append(field);
        }
        previewLoaded = true;
      }
    } catch (error) {
      preview.textContent = error.message;
    }
  };
  const previewButton = element('button', 'Update preview', 'button subtle');
  previewButton.addEventListener('click', () => guarded(updatePreview));
  previewDetails.append(previewButton);
  previewDetails.addEventListener('toggle', () => {
    if (previewDetails.open) updatePreview();
  });
  body.append(previewDetails);
  const actions = element('div', undefined, 'detail-actions'),
    save = element('button', 'Save & recheck', 'button primary'),
    approve = actionButton('Approve & next', 'button primary');
  save.disabled = true;
  save.hidden = true;
  editor.addEventListener('input', () => {
    state.dirty = editor.value !== job.translation;
    save.disabled = !state.dirty || editor.disabled;
    save.hidden = !state.dirty;
    approve.hidden = state.dirty || job.status !== 'review';
    approve.disabled = state.dirty || !can('approve') || job.status !== 'review';
    if (job.source.kind !== 'icu') preview.textContent = editor.value;
  });
  save.addEventListener('click', () =>
    guarded(async () => {
      await api(path('/jobs/' + job.id), 'PATCH', {
        revision: job.revision,
        translation: editor.value,
      });
      state.dirty = false;
      await refresh();
      notify(
        'Changes saved and queued for independent review. Your published version stays available.',
      );
    }),
  );
  approve.disabled = !can('approve') || job.status !== 'review';
  approve.hidden = job.status !== 'review';
  approve.addEventListener('click', () =>
    guarded(async () => {
      if (editor.value !== job.translation) throw new Error('Save your changes before approving.');
      const validation = await api(path('/jobs/' + job.id + '/validation'));
      if (validation.findings.some((finding) => finding.severity === 'critical'))
        throw new Error('Correct the protected structure before approving this translation.');
      let overrideReason;
      if (job.findings.some((finding) => finding.severity !== 'minor')) {
        overrideReason = await askDecision({
          title: 'Approve with review findings',
          message:
            'Explain why this wording is suitable despite the findings. The explanation stays in the approval audit.',
          accept: 'Approve translation',
          reason: true,
        });
        if (!overrideReason?.trim()) return;
      }
      const nextId = state.records[state.records.findIndex((item) => item.id === job.id) + 1]?.id;
      await api(path('/jobs/' + job.id + '/approve'), 'POST', {
        revision: job.revision,
        overrideReason,
      });
      state.selected = null;
      await refresh();
      state.selected =
        state.records.find((item) => item.id === nextId) ??
        state.records.find((item) => item.status === 'review') ??
        null;
      renderRows();
      renderDetail();
      $('#detail-heading')?.focus();
      notify('Approved. This wording is now available in approved exports.');
    }),
  );
  actions.append(save, approve);
  if (job.status === 'failed') {
    const retry = element('button', 'Retry translation', 'button');
    retry.disabled = !can('translate') || !state.session.providersReady;
    retry.addEventListener('click', () =>
      guarded(async () => {
        await api(path('/jobs/' + job.id + '/retry'), 'POST', {});
        await refresh();
      }),
    );
    actions.append(retry);
  }
  body.append(
    actions,
    element(
      'p',
      state.project.approvalMode === 'automatic'
        ? 'Automatic approval accepts clean AI-reviewed revisions. Flagged wording still needs attention.'
        : 'Human approval is required for this project. AI prepares the translation and review findings.',
      'approval-note',
    ),
  );
  findings.after(actions);
  const metadata = element('details');
  metadata.append(
    element('summary', 'Message details'),
    element('p', 'Identifier: ' + job.unitId),
    element('p', 'Revision: ' + job.revision),
    element('p', 'Protected terms: ' + (job.source.protectedTerms.join(', ') || 'None specified')),
  );
  body.append(metadata);
  panel.append(header, body);
}
function selectDocument(namespace) {
  $('#document').value = namespace;
  state.imported =
    state.documents.find((document) => document.namespace === namespace)?.units ?? [];
  $('#document-panel').hidden = !namespace;
  const document = state.documents.find((item) => item.namespace === namespace);
  $('#document-heading').textContent = document?.namespace ?? 'Selected content';
  $('#document-description').textContent = document
    ? document.units.length +
      ' segments · ' +
      document.format.toUpperCase() +
      ' · Changes follow your project approval rules.'
    : '';
  applyActionAvailability();
}
function renderContent() {
  const list = $('#content-list');
  list.replaceChildren();
  for (const document of state.documents) {
    const row = element('div', undefined, 'content-row'),
      info = element('div', undefined, 'file-info'),
      open = actionButton('Open', 'text-button');
    info.append(
      element('h3', document.namespace),
      element('p', document.units.length + ' segments · ' + document.format.toUpperCase()),
    );
    open.setAttribute('aria-label', 'Open ' + document.namespace);
    open.addEventListener('click', () => {
      selectDocument(document.namespace);
      $('#document-heading').scrollIntoView({ block: 'nearest' });
    });
    const fileIcon = element('span', undefined, 'file-icon');
    fileIcon.append(icon('file'));
    row.append(fileIcon, info, open);
    list.append(row);
  }
  if (!state.documents.length) {
    const empty = element('div', undefined, 'empty-state');
    empty.append(
      element(
        'h2',
        state.summary?.sourceUnits
          ? 'Your messages came through the API.'
          : 'Your next language starts here.',
      ),
      element(
        'p',
        state.summary?.sourceUnits
          ? 'Review them in the editor or export approved catalogs from Connect. Import a document to enable whole-document previews.'
          : 'Add a file from your app or paste an article. You can also automate imports through the CLI or API.',
      ),
    );
    list.append(empty);
  }
  selectDocument($('#document').value);
}
function codeBlock(code) {
  const wrapper = element('div', undefined, 'code-block'),
    pre = element('pre', code),
    copy = actionButton('Copy', 'copy-button', 'copy', true);
  pre.tabIndex = 0;
  copy.setAttribute('aria-label', 'Copy setup example');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify('Setup example copied.');
    } catch {
      notify('Copy is unavailable. Select the example text to copy it.', true);
    }
  });
  wrapper.append(pre, copy);
  return wrapper;
}
function renderIntegration() {
  const project = state.project?.id ?? 'your-project',
    locale = state.project?.targetLocales[0] ?? 'ar',
    locales = state.project?.targetLocales.join(',') || 'ar,zh-Hant-TW,de,es,fr',
    container = $('#integration-guide');
  container.replaceChildren();
  const guides = {
    cli: {
      title: 'Your files. A repeatable workflow.',
      description:
        'Run the CLI from your EveryLocale checkout. Store a scoped token in your shell or CI secrets. These packages are local releases, not published npm packages.',
      steps: [
        [
          'Extract the text you want to translate',
          'Use explicit message declarations or a structured file. This example reads a JSON catalog.',
          'pnpm cli extract --input ./messages.json --format json --namespace app --output ./source.json',
        ],
        [
          'Sync and wait for approved translations',
          'Set EVERYLOCALE_URL and a scoped EVERYLOCALE_TOKEN in your environment. Clean translations approve automatically. Flagged or human-gated work pauses here for review.',
          'pnpm cli sync --project ' +
            project +
            ' --input ./source.json --locales ' +
            locales +
            ' --wait --timeout 600',
        ],
        [
          'Deliver all languages as one release',
          'Pull verifies complete current approvals and switches locales/current.json atomically. Read that pointer once per build. Keep previous releases for rollback.',
          'pnpm cli pull --project ' + project + ' --output ./locales',
        ],
      ],
    },
    http: {
      title: 'One API for any stack.',
      description:
        'Use server-to-server requests. Import, translate, review, and export have separate permissions. Full contracts are in docs/API.md in the checkout.',
      steps: [
        [
          'Connect with a scoped token',
          'Send the token as a Bearer header. Never expose it to a public browser bundle.',
          'GET ' + location.origin + '/api/v1/projects/' + project,
        ],
        [
          'Import a structured source',
          'POST /sources imports text without starting paid model calls. Submit /jobs separately with a stable Idempotency-Key.',
          'POST /api/v1/projects/' +
            project +
            '/sources\n{ "units": [{ "id": "welcome", "source": "Welcome", "kind": "text", "sourceLocale": "en" }] }',
        ],
        [
          'Read only approved words',
          'Use current=true when a deployment must have approval for the latest source.',
          'GET /api/v1/projects/' + project + '/exports/' + locale + '?current=true',
        ],
      ],
    },
    remix: {
      title: 'Language belongs in the request.',
      description:
        'Use the packaged adapters with Remix 2. Resolve each request on the server and pass its approved catalog into your React provider. No framework upgrade is needed.',
      steps: [
        [
          'Install the local release',
          'Run pnpm release:pack in EveryLocale. Follow docs/CONNECT.md for package installation, then docs/INTEGRATION.md for the tested Remix 2 loader pattern.',
        ],
        [
          'Resolve and load on the server',
          'Keep credentials in server environment variables. Public URL language takes priority.',
          'import { resolveRequest, EveryLocaleClient } from "@everylocale/adapters";\n\nconst { locale, direction } = resolveRequest(request);\nconst client = new EveryLocaleClient(process.env.EVERYLOCALE_URL, process.env.EVERYLOCALE_TOKEN);\nconst catalog = await client.catalog("' +
            project +
            '", locale);',
        ],
        [
          'Render with the same catalog',
          'Use EveryLocaleProvider from @everylocale/react around your route. Set html lang and dir from the loader; use remixMeta for published alternates.',
        ],
      ],
    },
    next: {
      title: 'Server rendering, without a language flash.',
      description:
        'The Next.js example demonstrates concurrent Arabic, Taiwan Chinese, and German pages with approved catalogs and language-aware metadata.',
      steps: [
        [
          'Install the local release',
          'Run pnpm release:pack in EveryLocale. Use docs/CONNECT.md for package installation. The working app is in examples/next.',
        ],
        [
          'Load approved words server-side',
          'Resolve the incoming Request, fetch the catalog on the server, and pass it to your provider.',
          'import { resolveRequest, EveryLocaleClient } from "@everylocale/adapters";\n\nconst { locale, direction } = resolveRequest(request);\nconst client = new EveryLocaleClient(process.env.EVERYLOCALE_URL, process.env.EVERYLOCALE_TOKEN);\nconst catalog = await client.catalog("' +
            project +
            '", locale);',
        ],
        [
          'Keep publication and SEO together',
          'Use nextMetadata with the published-page registry. Unavailable locales return an unavailable page rather than silently displaying another language.',
        ],
      ],
    },
    wordpress: {
      title: 'Write once. Review each language.',
      description:
        'The free WordPress connector creates linked translation drafts and delivers approved content. Your English publication stays the source of truth.',
      steps: [
        [
          'Install the connector',
          'Copy adapters/wordpress into wp-content/plugins/everylocale and activate EveryLocale. See adapters/wordpress/README.md.',
        ],
        [
          'Connect in WordPress settings',
          'Open Settings / EveryLocale. Enter this service URL, your project identifier, and a scoped token with read, import, translate, and export permissions.',
          'Service URL: ' + location.origin + '\nProject: ' + project,
        ],
        [
          'Publish, review, then deliver',
          'Original publishing creates translation jobs. Your automatic or human approval mode applies here. WordPress cron checks every five minutes and publishes approved translations; production needs a reliable system cron.',
        ],
      ],
    },
  };
  const guide = guides[state.integration];
  container.append(element('h2', guide.title), element('p', guide.description));
  guide.steps.forEach(([title, description, code], index) => {
    const step = element('div', undefined, 'guide-step'),
      marker = element('span', index + 1, 'step-marker'),
      body = element('div');
    marker.setAttribute('aria-hidden', 'true');
    body.append(element('h3', title), element('p', description));
    if (code) body.append(codeBlock(code));
    step.append(marker, body);
    container.append(step);
  });
  const help = element('p', undefined, 'guide-links');
  for (const [slug, title] of [
    ['connect', 'Complete setup guide'],
    ['integration', 'Runtime integration'],
    ['api', 'API reference'],
  ]) {
    const link = element('a', title);
    link.href = '/assets/guides/' + slug + '.html';
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', title + ' (opens a new tab)');
    help.append(link);
  }
  container.append(help);
}

function renderProviderAccounts() {
  const container = $('#chatgpt-connections');
  const accounts = state.providerAccounts?.accounts ?? [];
  container.hidden = !accounts.length;
  container.replaceChildren();
  if (!accounts.length) return;
  const intro = element('div');
  const heading = element('h2', 'ChatGPT plan connection');
  heading.id = 'chatgpt-heading';
  intro.append(
    heading,
    element(
      'p',
      'Eligible requests use your ChatGPT plan allowance. Other configured providers keep their own budgets.',
      'small',
    ),
  );
  const usage = element('a', 'Manage usage');
  usage.href = 'https://chatgpt.com/settings/usage';
  usage.target = '_blank';
  usage.rel = 'noopener';
  usage.setAttribute('aria-label', 'Manage ChatGPT usage (opens a new tab)');
  intro.append(usage);
  const controls = element('div', undefined, 'export-controls');
  for (const account of accounts) {
    const status = account.paused
      ? 'Paused. Check usage or reconnect on the service host.'
      : account.connected && account.enabled
        ? 'Using your ChatGPT plan'
        : 'Plan usage is disabled. Connect on the service host to enable it.';
    const row = element('div');
    row.append(element('strong', account.label), element('p', status, 'small'));
    if (account.connected) {
      const disconnect = actionButton('Disconnect', 'button', 'sign-out');
      disconnect.addEventListener('click', () =>
        guarded(async () => {
          if (
            !(await askDecision({
              title: 'Disconnect this ChatGPT account?',
              message:
                'Queued work using this account will pause until you reconnect or select another provider.',
              accept: 'Disconnect',
            }))
          )
            return;
          const result = await api(
            '/chatgpt/accounts/' + encodeURIComponent(account.id) + '/disconnect',
            'POST',
            {},
          );
          await refresh();
          notify(
            result.revoked
              ? 'ChatGPT disconnected.'
              : 'Local credentials removed. Remote revocation could not be confirmed; review your ChatGPT connections.',
          );
        }),
      );
      row.append(disconnect);
    }
    controls.append(row);
  }
  container.append(intro, controls);
}
document.querySelectorAll('[data-integration]').forEach((button) =>
  button.addEventListener('click', () => {
    state.integration = button.dataset.integration;
    document
      .querySelectorAll('[data-integration]')
      .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderIntegration();
  }),
);
$('#batch-mode').addEventListener('click', () => {
  state.batch = !state.batch;
  state.checked.clear();
  renderRows();
});
$('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  guarded(async () => {
    const result = await api('/session', 'POST', { token: $('#owner-token').value });
    state.csrf = result.csrf;
    $('#owner-token').value = '';
    await boot();
  });
});
$('#logout').addEventListener('click', () =>
  guarded(async () => {
    if (!(await discardCorrections())) return;
    await api('/session', 'DELETE');
    showLogin();
  }),
);
$('#project').addEventListener('change', () =>
  guarded(async () => {
    if (!(await discardCorrections())) {
      $('#project').value = state.project.id;
      return;
    }
    state.project = state.projects.find((x) => x.id === $('#project').value);
    await selectProject();
  }),
);
for (const id of ['language', 'status'])
  $('#' + id).addEventListener('change', () =>
    guarded(async () => {
      if (!(await discardCorrections())) {
        $('#' + id).value =
          state.filters?.[id] ?? (id === 'language' ? state.project.targetLocales[0] : 'review');
        return;
      }
      state.lastStatus = $('#status').value;
      state.selected = null;
      state.checked.clear();
      await refresh();
    }),
  );
let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () =>
      guarded(async () => {
        if (!(await discardCorrections())) {
          $('#search').value = state.filters?.search ?? '';
          return;
        }
        state.selected = null;
        state.checked.clear();
        await refresh();
      }),
    300,
  );
});
$('#refresh').addEventListener('click', () =>
  guarded(async () => {
    if (await discardCorrections()) await refresh();
  }),
);
$('#load-more').addEventListener('click', () => guarded(() => refresh(true)));

function addTerm(entry = { source: '', keep: true, targets: {} }) {
  const row = element('div', undefined, 'term-row'),
    index = crypto.randomUUID(),
    sourceLabel = element('label', 'Original term'),
    source = element('input');
  source.id = 'term-' + index;
  source.dataset.termSource = '';
  source.value = entry.source;
  source.required = true;
  sourceLabel.htmlFor = source.id;
  const keepLabel = element('label', undefined, 'keep-label'),
    keep = element('input');
  keep.type = 'checkbox';
  keep.dataset.termKeep = '';
  keep.checked = Boolean(entry.keep);
  keepLabel.append(keep, document.createTextNode('Keep this term in its original language'));
  const targets = element('div');
  const locales = [
    ...new Set([
      ...(state.project?.targetLocales ??
        state.locales.filter((locale) => locale.id !== 'en').map((locale) => locale.id)),
      ...Object.keys(entry.targets),
    ]),
  ];
  for (const locale of locales) {
    const label = nativeLanguage(locale, 'label'),
      input = element('input');
    input.id = 'term-' + index + '-' + locale;
    label.htmlFor = input.id;
    input.dataset.termLocale = locale;
    input.value = entry.targets[locale] ?? '';
    targets.append(label, input);
  }
  targets.hidden = keep.checked;
  keep.addEventListener('change', () => (targets.hidden = keep.checked));
  const remove = element('button', 'Remove term', 'text-button');
  remove.type = 'button';
  remove.addEventListener('click', () => row.remove());
  row.append(sourceLabel, source, keepLabel, targets, remove);
  $('#glossary-fields').append(row);
}
function setupLanguageFields(project) {
  const selected = project?.targetLocales ?? ['ar', 'zh-Hant-TW', 'de', 'es', 'fr'];
  $('#target-choices').replaceChildren();
  for (const locale of state.locales) {
    const label = element('label'),
      checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.value = locale.id;
    checkbox.checked = selected.includes(locale.id);
    checkbox.disabled = locale.id === $('#source-locale').value;
    label.append(checkbox, nativeLanguage(locale.id));
    $('#target-choices').append(label);
  }
  $('#glossary-fields').replaceChildren();
  for (const entry of project?.glossary ?? []) addTerm(entry);
  $('#instruction-fields').replaceChildren();
  for (const locale of [...new Set([...selected, ...Object.keys(project?.instructions ?? {})])]) {
    const label = element('label'),
      input = element('textarea');
    label.append(nativeLanguage(locale), ' guidance');
    input.id = 'guidance-' + locale;
    label.htmlFor = input.id;
    input.dataset.locale = locale;
    input.rows = 2;
    input.maxLength = 4000;
    input.placeholder = 'Tone, audience, and any language-specific instructions';
    input.value = project?.instructions[locale] ?? '';
    $('#instruction-fields').append(label, input);
  }
}
$('#add-term').addEventListener('click', () => addTerm());
$('#content-language').addEventListener('change', applyActionAvailability);
$('#export-language').addEventListener('change', applyActionAvailability);
$('#project-name').addEventListener('input', () => {
  if (!$('#project-id').disabled && !$('#project-id').dataset.manual)
    $('#project-id').value = $('#project-name')
      .value.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
});
$('#project-id').addEventListener('input', () => ($('#project-id').dataset.manual = 'true'));

async function projectDialog(edit) {
  if (!(await discardCorrections())) return;
  $('#project-form').reset();
  $('#project-form').dataset.mode = edit ? 'edit' : 'create';
  delete $('#project-id').dataset.manual;
  const source = edit ? state.project.sourceLocale : 'en';
  $('#source-locale').replaceChildren(
    ...[...new Set([...state.locales.map((locale) => locale.id), source])].map((locale) => {
      const option = nativeLanguage(locale, 'option');
      option.value = locale;
      return option;
    }),
  );
  $('#source-locale').value = source;
  document.querySelector(
    `[name="approval-mode"][value="${edit ? (state.project.approvalMode ?? 'human') : 'automatic'}"]`,
  ).checked = true;
  $('#project-dialog h2').textContent = edit ? 'Project settings' : 'Create a project';
  $('#project-form button[type="submit"]').textContent = edit ? 'Save settings' : 'Create project';
  $('#project-id').disabled = edit;
  $('#source-locale').disabled = edit;
  if (edit) {
    const project = state.project;
    $('#project-name').value = project.name;
    $('#project-id').value = project.id;
    $('#source-locale').value = project.sourceLocale;
    $('#target-locales').value = project.targetLocales
      .filter((locale) => !state.locales.some((item) => item.id === locale))
      .join(',');
    $('#project-budget').value = project.budgetUsd;
  }
  setupLanguageFields(edit ? state.project : null);
  $('#project-dialog').showModal();
}
$('#new-project').addEventListener('click', () => projectDialog(false));
$('#settings').addEventListener('click', () => {
  if (state.project) projectDialog(true);
});
$('#import').addEventListener('click', () => {
  if (!state.project) return notify('Create a project first.', true);
  $('#import-dialog').showModal();
});
document
  .querySelectorAll('[data-close]')
  .forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$('#project-form').addEventListener(
  'invalid',
  (event) => {
    let ancestor = event.target.parentElement;
    while (ancestor) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
  },
  true,
);
$('#source-locale').addEventListener('change', () => {
  for (const checkbox of $('#target-choices').querySelectorAll('input')) {
    checkbox.disabled = checkbox.value === $('#source-locale').value;
    if (checkbox.disabled) checkbox.checked = false;
  }
});
$('#project-form').addEventListener('submit', (event) => {
  event.preventDefault();
  guarded(async () => {
    const id = $('#project-id').value;
    const creating = $('#project-form').dataset.mode === 'create';
    state.project = await api(`/projects/${encodeURIComponent(id)}`, 'PUT', {
      name: $('#project-name').value,
      sourceLocale: $('#source-locale').value,
      targetLocales: [
        ...new Set(
          [...$('#target-choices').querySelectorAll('input:checked')]
            .map((input) => input.value)
            .concat(
              $('#target-locales')
                .value.split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            ),
        ),
      ],
      budgetUsd: Number($('#project-budget').value),
      approvalMode: document.querySelector('[name="approval-mode"]:checked').value,
      glossary: [...$('#glossary-fields').children].map((row) => ({
        source: row.querySelector('[data-term-source]').value,
        keep: row.querySelector('[data-term-keep]').checked,
        targets: Object.fromEntries(
          [...row.querySelectorAll('[data-term-locale]')]
            .map((input) => [input.dataset.termLocale, input.value])
            .filter(([, value]) => value),
        ),
      })),
      instructions: Object.fromEntries(
        [...$('#instruction-fields').querySelectorAll('textarea')]
          .map((input) => [input.dataset.locale, input.value])
          .filter(([, value]) => value),
      ),
    });
    $('#project-dialog').close();
    await projects();
    if (creating) renderView('overview');
    notify(
      creating
        ? 'Project created. Add your first content to get started.'
        : 'Settings saved. Changed guidance requires a new translation and approval.',
    );
  });
});
$('#import-file').addEventListener('change', async () => {
  const file = $('#import-file').files[0];
  if (file) {
    if (file.size > 2000000) return notify('Choose a file smaller than 2 MB.', true);
    $('#content').value = await file.text();
    const extension = file.name.split('.').at(-1).toLowerCase();
    const formats = {
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      po: 'po',
      md: 'markdown',
      markdown: 'markdown',
      mdx: 'mdx',
      html: 'html',
      htm: 'html',
    };
    if (formats[extension]) $('#format').value = formats[extension];
    $('#namespace').value = file.name.replace(/\.[^.]+$/, '');
  }
});
$('#import-form').addEventListener('submit', (event) => {
  event.preventDefault();
  guarded(async () => {
    if (!(await discardCorrections())) return;
    const result = await api(path('/documents'), 'POST', {
      content: $('#content').value,
      format: $('#format').value,
      namespace: $('#namespace').value,
    });
    state.imported = result.units;
    $('#import-dialog').close();
    const namespace = $('#namespace').value;
    await selectProject();
    selectDocument(namespace);
    state.imported = result.units;
    state.view = 'content';
    for (const name of ['overview', 'review', 'content', 'connect'])
      $('#view-' + name).hidden = name !== 'content';
    document.querySelectorAll('[data-view]').forEach((button) => {
      if (button.dataset.view === 'content') button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    notify(`${result.changed.length} changed segments imported. Start translation when ready.`);
  });
});
$('#translate').addEventListener('click', () =>
  guarded(async () => {
    if (!state.project) throw new Error('Create a project first.');
    if (!state.imported.length) throw new Error('Import the content you want to translate first.');
    await api(path('/jobs'), 'POST', {
      unitIds: state.imported,
      locales: [$('#content-language').value],
    });
    $('#language').value = $('#content-language').value;
    $('#status').value = 'pending';
    await refresh();
    notify('Changed content queued for translation and review.');
  }),
);
$('#batch-approve').addEventListener('click', () =>
  guarded(async () => {
    const jobs = state.records.filter((x) => state.checked.has(x.id));
    if (jobs.some((x) => x.status !== 'review' || x.findings.some((f) => f.severity !== 'minor')))
      throw new Error('Review material findings individually before approving this selection.');
    await api(path('/approve'), 'POST', {
      entries: jobs.map((x) => ({ id: x.id, revision: x.revision })),
    });
    state.checked.clear();
    await refresh();
    notify(`${jobs.length} translations approved.`);
  }),
);
$('#export').addEventListener('click', () =>
  guarded(async () => {
    if (!state.project) throw new Error('Create a project first.');
    const locale = $('#export-language').value;
    if (!locale) throw new Error('Choose a language to export.');
    const catalog = await api(path(`/exports/${encodeURIComponent(locale)}`), 'POST', {});
    const link = element('a');
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' }),
    );
    link.download = `${state.project.id}.${locale}.approved.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    notify('Approved catalog exported and retained for rollback.');
  }),
);
async function boot() {
  try {
    state.locales = await api('/locales');
    const session = await api('/session');
    state.session = session;
    state.csrf = session.csrf;
    $('#login').hidden = true;
    $('#workspace').hidden = false;
    $('#logout').hidden = false;
    for (const id of ['new-project', 'settings', 'tokens']) $('#' + id).hidden = !session.owner;
    $('#import').hidden = !can('import');
    $('#translate').hidden = !can('translate');
    $('#batch-approve').hidden = !can('approve');
    $('#export').hidden = !can('export');
    $('#download-document').hidden = !can('export');
    $('#versions').hidden = !can('export');
    await projects();
    applyActionAvailability();
  } catch (error) {
    showLogin();
    if (!error.message.includes('Authentication required')) notify(error.message, true);
  }
}
$('#document').addEventListener('change', () => {
  selectDocument($('#document').value);
});
$('#preview-document').addEventListener('click', () =>
  guarded(async () => {
    const namespace = $('#document').value,
      locale = $('#content-language').value;
    if (!namespace || !locale) throw new Error('Choose content and a language first.');
    const preview = await api(
      path(`/documents/${encodeURIComponent(namespace)}/preview/${encodeURIComponent(locale)}`),
    );
    $('#preview-notice').textContent = preview.pendingUnits.length
      ? `Private preview only. ${preview.pendingUnits.length} segments still show original wording while translation or review is pending.`
      : 'Private preview only. Exports follow your project approval rules. Links, scripts, and external assets are disabled in this preview.';
    $('#source-preview').srcdoc = preview.source;
    $('#target-preview').srcdoc = preview.translation;
    $('#preview-dialog').showModal();
  }),
);
function download(content, filename) {
  const link = element('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
$('#download-document').addEventListener('click', () =>
  guarded(async () => {
    const namespace = $('#document').value,
      locale = $('#content-language').value;
    if (!namespace || !locale) throw new Error('Choose content and a language first.');
    const result = await api(
      path(`/documents/${encodeURIComponent(namespace)}/export/${encodeURIComponent(locale)}`),
    );
    const format = state.documents.find((document) => document.namespace === namespace).format;
    download(
      result.content,
      `${namespace.replaceAll(':', '-')}.${locale}.${format === 'markdown' ? 'md' : format}`,
    );
  }),
);
async function loadTokens() {
  $('#token-list').replaceChildren(element('h2', 'Existing tokens'));
  for (const token of await api(path('/tokens'))) {
    const row = element('div', undefined, 'management-row');
    row.append(
      element(
        'p',
        `${token.scopes.join(', ')} | Expires ${new Date(token.expires_at).toLocaleDateString()}${token.revoked ? ' | Revoked' : ''}`,
      ),
    );
    if (!token.revoked) {
      const button = element('button', 'Revoke', 'button');
      button.addEventListener('click', () =>
        guarded(async () => {
          await api(path(`/tokens/${token.id}`), 'DELETE');
          await loadTokens();
        }),
      );
      row.append(button);
    }
    $('#token-list').append(row);
  }
}
$('#tokens').addEventListener('click', () =>
  guarded(async () => {
    if (!state.project) throw new Error('Create a project first.');
    $('#new-token').hidden = true;
    $('#token-value').value = '';
    $('#token-scopes').replaceChildren();
    for (const scope of ['read', 'import', 'translate', 'review', 'approve', 'export']) {
      const label = element('label'),
        checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.value = scope;
      checkbox.checked = ['read', 'import', 'translate', 'export'].includes(scope);
      const descriptions = {
        read: 'View project',
        import: 'Import content',
        translate: 'Run translation',
        review: 'Edit translations',
        approve: 'Approve publication',
        export: 'Export approved',
      };
      label.append(checkbox, document.createTextNode(descriptions[scope]));
      $('#token-scopes').append(label);
    }
    await loadTokens();
    $('#tokens-dialog').showModal();
  }),
);
$('#token-form').addEventListener('submit', (event) => {
  event.preventDefault();
  guarded(async () => {
    const scopes = [...$('#token-scopes').querySelectorAll('input:checked')].map(
      (input) => input.value,
    );
    const result = await api(path('/tokens'), 'POST', {
      scopes,
      expiresAt: Date.now() + Number($('#token-days').value) * 86400000,
    });
    $('#token-value').value = result.token;
    $('#new-token').hidden = false;
    await loadTokens();
  });
});
$('#versions').addEventListener('click', () =>
  guarded(async () => {
    if (!state.project) throw new Error('Create a project first.');
    const locale = $('#export-language').value;
    if (!locale) throw new Error('Choose a language first.');
    $('#version-list').replaceChildren();
    for (const version of await api(path(`/artifacts?locale=${encodeURIComponent(locale)}`))) {
      const row = element('div', undefined, 'management-row');
      row.append(
        element(
          'p',
          `${new Date(version.created_at).toLocaleString()} | ${version.id.slice(0, 12)}`,
        ),
      );
      const button = element('button', 'Restore this version', 'button');
      button.disabled = !can('approve');
      button.addEventListener('click', () =>
        guarded(async () => {
          if (
            !(await askDecision({
              title: 'Restore approved version',
              message: 'Restore this approved version? Your current export changes immediately.',
              accept: 'Restore version',
            }))
          )
            return;
          await api(path('/rollback'), 'POST', { locale, artifactId: version.id });
          $('#versions-dialog').close();
          notify('Approved version restored. Export it to update your application.');
        }),
      );
      row.append(button);
      $('#version-list').append(row);
    }
    if (!$('#version-list').children.length)
      $('#version-list').append(
        element('p', 'Export an approved catalog to retain a version here.'),
      );
    $('#versions-dialog').showModal();
  }),
);
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
setInterval(() => {
  if (
    !document.hidden &&
    !state.busy &&
    !state.dirty &&
    state.project &&
    !document.querySelector('dialog[open]') &&
    !$('#detail').contains(document.activeElement) &&
    state.summary?.languages.some((language) => language.working)
  )
    guarded(() => refresh());
}, 4000);
await boot();
