# Brightspace Downloader

Chrome extension that downloads a full TU Delft Brightspace course
(`https://brightspace.tudelft.nl`) into a sorted folder. No build step, no dependencies.

## Install

1. Open `chrome://extensions`, enable Developer mode.
2. "Load unpacked" and pick this folder.
   From WSL the path is `\\wsl$\<distro>\home\<you>\projects\my_toys\brightspace-downloader`.

## Use

1. Log in to Brightspace and open any page of a course.
2. Click the extension icon. A tab opens with the course name.
3. Pick one:
   - "Download to default folder": saves to `<default folder>/<year>_<course-name>`,
     for example `Uni/2026_machine-learning`. The first time it asks you to choose the
     default folder; "Change…" picks another one later.
   - "Download to another folder…": choose or create any folder; files go straight into it.
4. Keep the tab open until it says Done.

The year is the course start year: start date from Brightspace, else a year in the
course name, else the current year.

## Folder layout

- `announcements/` — one HTML file per announcement, date-prefixed, attachments next to it
- `assignments/<name>/` — `instructions.html` plus attached files
- `slides/` — PowerPoint/Keynote files, and PDFs under a lecture/slides module or title
- `exercises/` — assignments, tutorials, labs, homework found in course content
- `exams/` — exams, midterms, resits
- `recordings/` — video and audio files stored in the course
- `materials/` — every other file
- `links.html` — external links and items that are not files (videos on other sites, quizzes)

Inside each content folder the course's own module structure is kept, numbered in
course order.

## Limits

- Chrome asks to confirm access to the default folder once per browser session, unless
  you choose "Allow on every visit" in that prompt.
- Chrome refuses some folders in the picker: the Downloads/Documents/Desktop folders
  themselves and system folders. A subfolder of them works.
- Sorting into slides/exercises/exams is a keyword guess over module and file titles.
- Not downloaded: discussions, quizzes, grades, your own submissions, externally hosted video.

## Test

`node test.js`
