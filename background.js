import { ORIGIN, sanitize, cleanPath, courseFolder, planContent } from './lib.js';

const CONCURRENCY = 4; // be polite to the university server

const api = async (path) => {
  const r = await fetch(ORIGIN + path, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  try {
    return await r.json();
  } catch {
    throw new Error('Not logged in to Brightspace?');
  }
};

async function endpoints(id) {
  const versions = await api('/d2l/api/versions/');
  const v = (code) => versions.find((x) => x.ProductCode === code).LatestVersion;
  return { lp: `/d2l/api/lp/${v('lp')}`, le: `/d2l/api/le/${v('le')}/${id}` };
}

async function courseInfo(lp, id) {
  try {
    const c = await api(`${lp}/courses/${id}`);
    return { name: c.Name, start: c.StartDate };
  } catch {
    const e = await api(`${lp}/enrollments/myenrollments/${id}`);
    return { name: e.OrgUnit.Name, start: e.Access?.StartDate };
  }
}

// Folder override typed by the user, else <default folder>/<year>_<course-name>.
async function destination(lp, id, override) {
  const info = await courseInfo(lp, id);
  const { base = 'Brightspace' } = await chrome.storage.sync.get('base');
  const typed = cleanPath(override);
  const parts = typed.length ? typed : [...cleanPath(base), courseFolder(info.name, info.start)];
  return { name: info.name, parts };
}

const setStatus = (text, state = 'running') => chrome.storage.session.set({ status: { text, state } });

// Resolve each download when Chrome reports it finished or failed.
const pending = new Map();
chrome.downloads.onChanged.addListener((d) => {
  const state = d.state?.current;
  if (!state || state === 'in_progress' || !pending.has(d.id)) return;
  pending.get(d.id)(state === 'complete');
  pending.delete(d.id);
});

async function download({ url, parts }) {
  try {
    const id = await chrome.downloads.download({
      url,
      filename: parts.join('/'),
      conflictAction: 'overwrite', // re-running refreshes instead of "file (1).pdf"
      saveAs: false,
    });
    return await new Promise((resolve) => pending.set(id, resolve));
  } catch {
    return false;
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// <base> lets images/links relative to Brightspace still resolve from the saved file.
const page = (title, meta, body) =>
  `<!doctype html><meta charset="utf-8"><base href="${ORIGIN}/"><title>${esc(title)}</title>` +
  `<h1>${esc(title)}</h1><p><small>${esc(meta)}</small></p>${body}`;
const rich = (r) => r?.Html || `<pre>${esc(r?.Text)}</pre>`;
const day = (iso) => (iso ? iso.slice(0, 10) : 'undated');

async function run(id, override) {
  const { lp, le } = await endpoints(id);
  const { name, parts: root } = await destination(lp, id, override);
  const jobs = [];
  const skipped = [];
  const file = (path, ...parts) => jobs.push({ url: ORIGIN + path, parts: [...root, ...parts] });
  const html = (text, ...parts) =>
    jobs.push({ url: 'data:text/html;charset=utf-8,' + encodeURIComponent(text), parts: [...root, ...parts] });
  // One failing section (e.g. 403 on a disabled tool) must not lose the rest.
  const section = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      skipped.push(`${label}: ${e.message}`);
    }
  };

  await setStatus(`Reading ${name}…`);

  await section('content', async () => {
    const toc = await api(`${le}/content/toc`);
    const { files, links } = planContent(toc.Modules);
    for (const f of files) file(`${le}/content/topics/${f.topicId}/file`, ...f.parts);
    if (links.length) {
      const items = links.map(
        (l) => `<li>${esc(l.module)} — <a href="${esc(new URL(l.url, ORIGIN).href)}">${esc(l.title)}</a></li>`
      );
      html(page(`${name} — links`, `${links.length} links and non-file items`, `<ul>${items.join('')}</ul>`), 'links.html');
    }
  });

  await section('announcements', async () => {
    for (const n of await api(`${le}/news/`)) {
      const stem = `${day(n.StartDate)}_${sanitize(n.Title)}`;
      html(page(n.Title, day(n.StartDate), rich(n.Body)), 'announcements', `${stem}.html`);
      for (const a of n.Attachments ?? [])
        file(`${le}/news/${n.Id}/attachments/${a.FileId}`, 'announcements', `${stem} - ${sanitize(a.FileName)}`);
    }
  });

  await section('assignments', async () => {
    for (const f of await api(`${le}/dropbox/folders/`)) {
      const dir = sanitize(f.Name);
      html(page(f.Name, f.DueDate ? `Due ${f.DueDate}` : 'No due date', rich(f.CustomInstructions)), 'assignments', dir, 'instructions.html');
      for (const a of f.Attachments ?? [])
        file(`${le}/dropbox/folders/${f.Id}/attachments/${a.FileId}`, 'assignments', dir, sanitize(a.FileName));
    }
  });

  let done = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        if (!(await download(jobs[next++]))) failed++;
        await setStatus(`${++done}/${jobs.length} files → Downloads/${root.join('/')}`);
      }
    })
  );

  const notes = [failed && `${failed} failed (see chrome://downloads)`, ...skipped].filter(Boolean);
  await setStatus(
    `Done: ${done - failed}/${jobs.length} files in Downloads/${root.join('/')}` + (notes.length ? `\n${notes.join('\n')}` : ''),
    notes.length ? 'error' : 'done'
  );
}

let running = false;
// A worker that just started cannot be mid-run: clear a stale "running" left by a killed one.
chrome.storage.session.get('status').then(({ status }) => {
  if (status?.state === 'running' && !running) setStatus('Interrupted — run again.', 'error');
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.type === 'info') {
    endpoints(msg.id)
      .then(({ lp }) => destination(lp, msg.id, ''))
      .then(({ name, parts }) => respond({ name, path: parts.join('/') }))
      .catch((e) => respond({ error: e.message }));
    return true; // async respond
  }
  if (msg.type === 'download' && !running) {
    running = true;
    // Chrome kills an idle service worker after 30s; a long single download is "idle".
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
    run(msg.id, msg.folder)
      .catch((e) => setStatus(e.message, 'error'))
      .finally(() => {
        running = false;
        clearInterval(keepAlive);
      });
  }
});
