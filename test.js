// node test.js
import assert from 'node:assert/strict';
import { sanitize, slug, courseIdFromUrl, courseFolder, extOf, categorize, planContent } from './lib.js';

assert.equal(sanitize(' a/b: c?. '), 'a_b_ c_');
assert.equal(sanitize('...'), 'untitled');
assert.equal(slug('Algoritmen & Datastructuren (2026/27 Q1)'), 'algoritmen-datastructuren-2026-27-q1');

assert.equal(courseIdFromUrl('https://brightspace.tudelft.nl/d2l/home/123456'), '123456');
assert.equal(courseIdFromUrl('https://brightspace.tudelft.nl/d2l/le/content/123456/Home'), '123456');
assert.equal(courseIdFromUrl('https://brightspace.tudelft.nl/d2l/lms/dropbox/user/folders_list.d2l?ou=42'), '42');
assert.equal(courseIdFromUrl('https://brightspace.tudelft.nl/d2l/home'), null);

assert.equal(courseFolder('Machine Learning', '2026-09-01T00:00:00.000Z'), '2026_machine-learning');
assert.equal(courseFolder('ML (2025/26 Q3)', null), '2025_ml-2025-26-q3');
assert.equal(courseFolder('ML', null, new Date('2024-05-05')), '2024_ml');

assert.equal(extOf('/content/enforced/1-X/Lecture 1.PDF?x=1'), '.pdf');
assert.equal(extOf('/content/v1.2/noext'), '');

assert.equal(categorize('Week 1 intro', '.pptx'), 'slides');
assert.equal(categorize('Week 1 Lecture 1', '.pdf'), 'slides');
assert.equal(categorize('Old exams 2023', '.pdf'), 'exams');
assert.equal(categorize('Worked example', '.pdf'), 'materials');
assert.equal(categorize('Week 2 Tutorial sheet', '.pdf'), 'exercises');
assert.equal(categorize('Lecture 3', '.mp4'), 'recordings');

const plan = planContent([
  {
    Title: 'Week 1',
    Topics: [
      { TopicId: 7, Title: 'Lecture 1', TypeIdentifier: 'File', Url: '/content/enforced/1-X/l1.pdf' },
      { TopicId: 8, Title: 'Recording', TypeIdentifier: 'Link', Url: 'https://example.com/v' },
    ],
    Modules: [
      { Title: 'Lab', Topics: [{ TopicId: 9, Title: 'data.zip', TypeIdentifier: 'File', Url: '/content/enforced/1-X/data.zip' }] },
    ],
  },
]);
assert.deepEqual(plan.files, [
  { topicId: 7, parts: ['slides', '01_Week 1', '01_Lecture 1.pdf'] },
  { topicId: 9, parts: ['exercises', '01_Week 1', '01_Lab', '01_data.zip'] },
]);
assert.deepEqual(plan.links, [{ module: 'Week 1', title: 'Recording', url: 'https://example.com/v' }]);

console.log('ok');
