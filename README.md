# Research: competitor teardowns with REA

`rea/targets.json` lists public pages of products similar to Reinvent. The
workflow `.github/workflows/rea.yml` runs on GitHub's runner (full internet,
Chrome installed) and, for each page, uses REA (Reverse Engineer Anything,
github.com/morluto/rea) to:

1. visit the page in an iPhone-sized Chrome and record the visit
   (`capture-browser-scenario`: network calls, console, accessibility text,
   screenshot),
2. export the scripts the page loaded (`export-web-scripts`),
3. reconstruct the front end's structure (`analyze-javascript-application`:
   endpoints, storage keys, service workers, timers, requests).

Only derived summaries are committed under `rea/out/<name>/`. Raw evidence,
which contains the sites' own scripts, is kept only as a workflow artifact for
7 days and is never committed.
