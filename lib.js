// Pure helpers shared by background.js and page.js. Checked by test.js.

export const ORIGIN = 'https://brightspace.tudelft.nl';

const pad = (n) => String(n).padStart(2, '0');

// One safe path segment (Windows is the strictest target).
export const sanitize = (s) =>
  String(s ?? '')
    .replace(/[<>:"/\\|?*~\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/^[. ]+|[. ]+$/g, '') || 'untitled';

export const slug = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'course';

export function courseIdFromUrl(url) {
  const m = /\/d2l\/(?:home|le\/[\w-]+|lms\/[\w-]+)\/(\d+)/.exec(url) || /[?&]ou=(\d+)/.exec(url);
  return m ? m[1] : null;
}

// "2026_course-name": start year from the course start date, else a year in the name, else now.
export function courseFolder(name, startDate, now = new Date()) {
  const year = startDate
    ? new Date(startDate).getFullYear()
    : /\b(20\d\d)\b/.exec(name)?.[1] ?? now.getFullYear();
  return `${year}_${slug(name)}`;
}

export const extOf = (url) =>
  (/(\.[a-z0-9]{1,8})(?:[?#]|$)/i.exec(String(url ?? ''))?.[1] ?? '').toLowerCase();

const SLIDE_EXT = ['.ppt', '.pptx', '.pps', '.ppsx', '.key', '.odp'];
const MEDIA_EXT = ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.mp3', '.wav'];

// ponytail: keyword heuristic over module path + title. Misfiles land in the wrong
// top folder but keep their module path; add per-course overrides if that bites.
export function categorize(text, ext) {
  if (SLIDE_EXT.includes(ext)) return 'slides';
  if (MEDIA_EXT.includes(ext)) return 'recordings';
  if (/\bexams?\b|tentamen|midterm|endterm|resit/i.test(text)) return 'exams';
  if (/assignment|homework|exercise|tutorial|practic|\blabs?\b|opdracht|werkcollege|problem set/i.test(text)) return 'exercises';
  if (ext === '.pdf' && /slide|lecture|college|sheets/i.test(text)) return 'slides';
  return 'materials';
}

// Walk the content table of contents -> files to download + external links.
export function planContent(modules, dirs = [], titles = [], out = { files: [], links: [] }) {
  (modules ?? []).forEach((m, i) => {
    const d = [...dirs, `${pad(i + 1)}_${sanitize(m.Title)}`];
    const t = [...titles, m.Title];
    (m.Topics ?? []).forEach((topic, j) => {
      const ext = extOf(topic.Url);
      if ((topic.TypeIdentifier === 'File' || topic.ActivityType === 1) && ext) {
        const name = sanitize(topic.Title);
        out.files.push({
          topicId: topic.TopicId ?? topic.Identifier,
          parts: [
            categorize([...t, topic.Title].join(' '), ext),
            ...d,
            `${pad(j + 1)}_${name.toLowerCase().endsWith(ext) ? name : name + ext}`,
          ],
        });
      } else if (topic.Url) {
        out.links.push({ module: t.join(' / '), title: topic.Title, url: topic.Url });
      }
    });
    planContent(m.Modules, d, t, out);
  });
  return out;
}
