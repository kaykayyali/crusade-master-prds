#!/usr/bin/env node
// OKF index-sync checker.
//
// Every concept file in an OKF bundle should be reachable from a navigation
// index (`index.md` per directory, per §6). This checker verifies that each
// non-reserved `.md` file is referenced from at least one `index.md` in the
// same directory, a parent directory, or the bundle root.
//
// Usage:
//   node check-index-sync.js <bundle-dir> [--json] [--explain]
//
// --explain: print a hint per issue showing how to fix it.
//
// Exit codes: 0 = clean, 1 = issues found, 2 = usage error.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['index.md', 'log.md']);

function walkMd(root) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) hits.push(full);
    }
  }
  return hits;
}

// Build a map: concept-relative-path -> array of (directory relative-path, index-relative-path)
// of every index.md that exists in the bundle, indexed by directory.
function buildIndexMap(root, files) {
  const indexFiles = files.filter((f) => path.basename(f).toLowerCase() === 'index.md');
  const byDir = new Map(); // dir-relative-path -> index-relative-path
  for (const idx of indexFiles) {
    const rel = path.relative(root, path.dirname(idx)).split(path.sep).join('/');
    byDir.set(rel, path.relative(root, idx).split(path.sep).join('/'));
  }
  return byDir;
}

// Read an index file and return the set of (raw-link-target) values mentioned.
// We accept both bundle-absolute (`/foo/bar.md`) and relative forms.
function extractIndexTargets(idxAbsPath, idxRelPath) {
  const text = fs.readFileSync(idxAbsPath, 'utf8');
  const idxDir = path.dirname(idxRelPath); // e.g., 'prds' for prds/index.md
  const targets = new Set();
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].split('#')[0].split('?')[0].trim();
    if (raw === '' || /^(https?:|mailto:|urn:)/i.test(raw)) continue;
    let resolved;
    if (raw.startsWith('/')) {
      resolved = raw.replace(/^\/+/, '');
    } else {
      // relative to index's directory
      resolved = path.posix.join(idxDir, raw);
    }
    resolved = resolved.split(path.sep).join('/');
    if (resolved.endsWith('.md')) resolved = resolved.slice(0, -3);
    targets.add(resolved);
  }
  return targets;
}

function hintFor(msg, file) {
  if (/not referenced from any index\.md/.test(msg)) {
    // file is e.g. "concepts/campaign-team.md"
    const dir = path.posix.dirname(file);
    const targetIdx = dir === '.' ? 'index.md' : `${dir}/index.md`;
    return `Add a bullet to ${targetIdx} linking to this concept, e.g.\n    * [Title](${file.replace(/\.md$/, '')})`;
  }
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { json: false, explain: false };
  const positional = [];
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write([
        'Usage: check-index-sync.js <bundle-dir> [--json] [--explain]',
        '',
        'Verifies every concept is referenced from at least one index.md.',
        '',
        '--explain: print a hint per issue showing the suggested fix.',
      ].join('\n') + '\n');
      process.exit(0);
    } else positional.push(a);
  }
  const target = positional[0];
  if (!target) {
    process.stderr.write('error: bundle directory required\n');
    process.exit(2);
  }
  const root = path.resolve(target);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.stderr.write(`error: not a directory: ${root}\n`);
    process.exit(2);
  }

  const files = walkMd(root);
  const indexMap = buildIndexMap(root, files);

  // Build the target set: union of all index targets across all indices.
  // A concept is "in sync" if it appears as a target in any of these.
  const allTargets = new Set();
  for (const idx of files.filter((f) => path.basename(f).toLowerCase() === 'index.md')) {
    const idxRel = path.relative(root, idx).split(path.sep).join('/');
    for (const t of extractIndexTargets(idx, idxRel)) allTargets.add(t);
  }

  // Check each concept file.
  const issues = [];
  let conceptCount = 0;
  for (const abs of files) {
    const name = path.basename(abs);
    if (RESERVED.has(name.toLowerCase())) continue;
    conceptCount++;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const conceptId = rel.replace(/\.md$/, '');
    if (!allTargets.has(conceptId)) {
      issues.push({ level: 'error', file: rel, msg: 'not referenced from any index.md' });
    }
  }

  const summary = { concepts: conceptCount, errors: issues.length };

  if (opts.json) {
    process.stdout.write(JSON.stringify({ root, summary, issues }, null, 2) + '\n');
  } else {
    process.stdout.write(`OKF index-sync — ${root}\n`);
    process.stdout.write(`  concepts: ${summary.concepts}\n`);
    process.stdout.write(`  errors:   ${summary.errors}\n`);
    if (issues.length === 0) {
      process.stdout.write('  all good ✓\n');
    } else {
      for (const it of issues) {
        process.stdout.write(`  [ERROR] ${it.file}: ${it.msg}\n`);
        if (opts.explain) {
          const hint = hintFor(it.msg, it.file);
          if (hint) {
            for (const line of hint.split('\n')) {
              process.stdout.write(`         hint: ${line}\n`);
            }
          }
        }
      }
    }
  }

  process.exit(summary.errors > 0 ? 1 : 0);
}

main();