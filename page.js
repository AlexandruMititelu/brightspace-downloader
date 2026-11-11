import { ORIGIN, sanitize, courseFolder, planContent } from './lib.js';

const CONCURRENCY = 4; // be polite to the university server
const $ = (id) => document.getElementById(id);
const tabCourseId = new URLSearchParams(location.search).get('id');

// --- default folder: a directory handle only survives in IndexedDB ---
const db = new Promise((resolve, reject) => {
  const r = indexedDB.open('brightspace-downloader', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const kv = async (mode, fn) => {
  const r = fn((await db).transaction('kv', mode).objectStore('kv'));
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
};
const pick = () => showDirectoryPicker({ mode: 'readwrite' });

// --- Brightspace API, authenticated by the browser session ---
const api = async (path) => {
  const r = await fetch(ORIGIN + path, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  try {
    return await r.json();
  } catch {
    throw new Error('Not logged in to Brightspace?');
  }
};

async function endpoints() {
  const versions = await api('/d2l/api/versions/');
  const v = (code) => versions.find((x) => x.ProductCode === code).LatestVersion;
  return { lp: `/d2l/api/lp/${v('lp')}`, le: `/d2l/api/le/${v('le')}` };
}

// Every course the user is enrolled in, newest first. Org unit type 3 = course offering.
async function listCourses(lp, le) {
  const items = [];
  let bookmark = '';
  do {
    const page = await api(`${lp}/enrollments/myenrollments/?orgUnitTypeId=3&bookmark=${bookmark}`);
    items.push(...page.Items);
    bookmark = page.PagingInfo?.HasMoreItems ? page.PagingInfo.Bookmark : '';
  } while (bookmark);
  return items
    .filter((e) => e.Access?.CanAccess !== false)
    .map((e) => ({
      id: String(e.OrgUnit.Id),
      name: e.OrgUnit.Name,
      start: e.Access?.StartDate ?? '',
      folder: courseFolder(e.OrgUnit.Name, e.Access?.StartDate),
      le: `${le}/${e.OrgUnit.Id}`,
    }))
    .sort((a, b) => b.start.localeCompare(a.start) || a.name.localeCompare(b.name));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// <base> lets images/links relative to Brightspace still resolve from the saved file.
const htmlPage = (title, meta, body) =>
  `<!doctype html><meta charset="utf-8"><base href="${ORIGIN}/"><title>${esc(title)}</title>` +
  `<h1>${esc(title)}</h1><p><small>${esc(meta)}</small></p>${body}`;
const rich = (r) => r?.Html || `<pre>${esc(r?.Text)}</pre>`;
const day = (iso) => (iso ? iso.slice(0, 10) : 'undated');

async function plan(le, name) {
  const jobs = [];
  const skipped = [];
  const file = (path, ...parts) => jobs.push({ url: ORIGIN + path, parts });
  const html = (text, ...parts) => jobs.push({ text, parts });
  // One failing section (e.g. 403 on a disabled tool) must not lose the rest.
  const section = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      skipped.push(`${label}: ${e.message}`);
    }
  };

  await section('content', async () => {
    const { files, links } = planContent((await api(`${le}/content/toc`)).Modules);
    for (const f of files) file(`${le}/content/topics/${f.topicId}/file`, ...f.parts);
    if (links.length) {
      const items = links.map(
        (l) => `<li>${esc(l.module)} — <a href="${esc(new URL(l.url, ORIGIN).href)}">${esc(l.title)}</a></li>`
      );
      html(htmlPage(`${name} — links`, `${links.length} links and non-file items`, `<ul>${items.join('')}</ul>`), 'links.html');
    }
  });

  await section('announcements', async () => {
    for (const n of await api(`${le}/news/`)) {
      const stem = `${day(n.StartDate)}_${sanitize(n.Title)}`;
      html(htmlPage(n.Title, day(n.StartDate), rich(n.Body)), 'announcements', `${stem}.html`);
      for (const a of n.Attachments ?? [])
        file(`${le}/news/${n.Id}/attachments/${a.FileId}`, 'announcements', `${stem} - ${sanitize(a.FileName)}`);
    }
  });

  await section('assignments', async () => {
    for (const f of await api(`${le}/dropbox/folders/`)) {
      const dir = sanitize(f.Name);
      html(htmlPage(f.Name, f.DueDate ? `Due ${f.DueDate}` : 'No due date', rich(f.CustomInstructions)), 'assignments', dir, 'instructions.html');
      for (const a of f.Attachments ?? [])
        file(`${le}/dropbox/folders/${f.Id}/attachments/${a.FileId}`, 'assignments', dir, sanitize(a.FileName));
    }
  });

  return { jobs, skipped };
}

async function write(root, job) {
  // Fetch before creating the file so a failed request leaves no empty file behind.
  const response = job.url && (await fetch(job.url, { credentials: 'include' }));
  if (response && !response.ok) throw new Error(`HTTP ${response.status}`);
  let dir = root;
  for (const part of job.parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const out = await (await dir.getFileHandle(job.parts.at(-1), { create: true })).createWritable();
  try {
    if (response) return await response.body.pipeTo(out); // streams; closes on finish
    await out.write(job.text);
    await out.close();
  } catch (e) {
    await out.abort().catch(() => {});
    throw e;
  }
}

async function run(root, where) {
  const status = (text) => ($('status').textContent = text);
  status('Reading course…');
  const { jobs, skipped } = await plan(course.le, course.name);
  const failed = [];
  let done = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        await write(root, job).catch((e) => failed.push(`${job.parts.join('/')}: ${e.message}`));
        status(`${++done}/${jobs.length} files → ${where}\nKeep this tab open.`);
      }
    })
  );
  status(
    [`Done: ${done - failed.length}/${jobs.length} files in ${where}`,
      ...skipped.map((s) => `Skipped ${s}`),
      ...failed.map((f) => `Failed ${f}`)].join('\n')
  );
}

// --- UI ---
let courses = [];
let course; // { id, name, start, folder, le }
let base = await kv('readonly', (s) => s.get('dir'));
let busy = false;

function render() {
  $('base').textContent = base?.name ?? 'not set';
  $('go').disabled = $('other').disabled = busy || !course;
  $('change').disabled = $('course').disabled = busy;
  $('hint').textContent = course ? `Default saves to ${base?.name ?? '<default folder>'}/${course.folder}` : '';
}

async function setBase() {
  base = await pick();
  await kv('readwrite', (s) => s.put(base, 'dir'));
  render();
}

// Wraps a button handler: picker cancel is silent, anything else is shown.
const action = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    if (e.name !== 'AbortError') $('status').textContent = e.message;
  } finally {
    busy = false;
    render();
  }
};
const start = () => {
  busy = true;
  render();
};

$('change').addEventListener('click', action(setBase));

$('go').addEventListener('click', action(async () => {
  if (!base) await setBase();
  // Chrome re-asks once per browser session unless "Allow on every visit" was chosen.
  if ((await base.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Folder access denied.');
  start();
  await run(await base.getDirectoryHandle(course.folder, { create: true }), `${base.name}/${course.folder}`);
}));

$('other').addEventListener('click', action(async () => {
  const dir = await pick();
  start();
  await run(dir, dir.name);
}));

$('course').addEventListener('change', () => {
  course = courses.find((c) => c.id === $('course').value);
  render();
});

render();
try {
  const { lp, le } = await endpoints();
  courses = await listCourses(lp, le);
  $('course').replaceChildren(...courses.map((c) => new Option(c.name, c.id)));
  // Preselect the course of the tab the icon was clicked on, else the newest.
  course = courses.find((c) => c.id === tabCourseId) ?? courses[0];
  if (course) $('course').value = course.id;
  else $('status').textContent = 'No courses found.';
} catch (e) {
  $('status').textContent = e.message;
}
render();
