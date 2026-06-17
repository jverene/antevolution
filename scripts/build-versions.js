/**
 * Build a static versions gallery from the git history.
 *
 * For each commit in the recent history this script extracts index.html,
 * style.css, and the src/ directory into versions/<hash>/ so you can open
 * and run any prior iteration of the simulation in the browser.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERSIONS_DIR = path.join(ROOT, 'versions');
const MAX_VERSIONS = 12;

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function showFile(commit, file) {
  try {
    return git(`show ${commit}:${file}`);
  } catch {
    return null;
  }
}

function listTree(commit, treePath) {
  try {
    return git(`ls-tree -r --name-only ${commit} ${treePath}`)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildVersions() {
  ensureDir(VERSIONS_DIR);

  const log = git(`log --format='%H|%s|%ci' -n ${MAX_VERSIONS}`);
  const commits = log.split('\n').map((line) => {
    const [hash, ...rest] = line.split('|');
    const date = rest.pop();
    const subject = rest.join('|');
    return { hash, subject, date: new Date(date).toLocaleString() };
  });

  for (const commit of commits) {
    const dir = path.join(VERSIONS_DIR, commit.hash);
    ensureDir(dir);
    ensureDir(path.join(dir, 'src'));

    const filesToExtract = ['index.html', 'style.css', 'README.md'];
    const srcFiles = listTree(commit.hash, 'src');
    filesToExtract.push(...srcFiles);

    for (const file of filesToExtract) {
      const content = showFile(commit.hash, file);
      if (content === null) continue;
      const outPath = path.join(dir, file);
      ensureDir(path.dirname(outPath));
      fs.writeFileSync(outPath, content);
    }

    console.log(`Extracted ${commit.hash.slice(0, 7)} — ${commit.subject}`);
  }

  // Build the menu page.
  const rows = commits
    .map((c) => {
      const short = c.hash.slice(0, 7);
      return `
        <tr>
          <td><code>${short}</code></td>
          <td>${c.date}</td>
          <td>${escapeHtml(c.subject)}</td>
          <td><a class="run" href="${c.hash}/index.html">Run this version</a></td>
        </tr>`;
    })
    .join('');

  const menuHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Evolution Sim — Version History</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
      background: #0f172a;
      color: #e2e8f0;
    }
    h1 { color: #38bdf8; }
    p { line-height: 1.6; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th, td {
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid #334155;
    }
    th { color: #94a3b8; }
    a.run {
      display: inline-block;
      padding: 6px 12px;
      background: #0ea5e9;
      color: #fff;
      text-decoration: none;
      border-radius: 4px;
      font-size: 0.875rem;
    }
    a.run:hover { background: #0284c7; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #a5f3fc;
    }
  </style>
</head>
<body>
  <h1>Evolution Simulation — Version History</h1>
  <p>
    Each row is a commit from the project history. Click <strong>Run this version</strong>
    to open the simulation exactly as it was at that point in time.
  </p>
  <table>
    <thead>
      <tr>
        <th>Commit</th>
        <th>Date</th>
        <th>Message</th>
        <th></th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</body>
</html>`;

  fs.writeFileSync(path.join(VERSIONS_DIR, 'index.html'), menuHtml);
  console.log(`\nWrote versions/index.html with ${commits.length} versions.`);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

buildVersions();
