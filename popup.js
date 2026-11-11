import { ORIGIN, courseIdFromUrl } from './lib.js';

const $ = (id) => document.getElementById(id);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const id = tab?.url?.startsWith(ORIGIN) ? courseIdFromUrl(tab.url) : null;
let ready = false;
let busy = false;
const sync = () => ($('go').disabled = !ready || busy);

function showStatus(status) {
  if (!status) return;
  $('status').textContent = status.text;
  busy = status.state === 'running';
  sync();
}
showStatus((await chrome.storage.session.get('status')).status);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.status) showStatus(changes.status.newValue);
});

async function refresh() {
  if (!id) return ($('course').textContent = 'Open a Brightspace course page first.');
  const info = await chrome.runtime.sendMessage({ type: 'info', id });
  if (info.error) return ($('course').textContent = info.error);
  $('course').textContent = info.name;
  $('folder').placeholder = info.path;
  ready = true;
  sync();
}

$('base').value = (await chrome.storage.sync.get('base')).base ?? 'Brightspace';
$('base').addEventListener('change', async () => {
  await chrome.storage.sync.set({ base: $('base').value });
  refresh();
});

$('go').addEventListener('click', () => {
  busy = true;
  sync();
  chrome.runtime.sendMessage({ type: 'download', id, folder: $('folder').value });
});

refresh();
