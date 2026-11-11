import { ORIGIN, courseIdFromUrl } from './lib.js';

// The folder picker needs a real page (a popup closes when the picker opens),
// so the icon opens page.html, which does all the work.
chrome.action.onClicked.addListener((tab) => {
  const id = tab.url?.startsWith(ORIGIN) ? courseIdFromUrl(tab.url) : null;
  chrome.tabs.create({ url: `page.html?id=${id ?? ''}`, index: tab.index + 1 });
});
