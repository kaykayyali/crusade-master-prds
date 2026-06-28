#!/usr/bin/env node
// OKF orphan detector.
//
// Every concept in an OKF bundle should have at least one inbound internal
// link from another file in the bundle. Concepts with no inbound links
// (orphans) are unreachable from the navigation graph — consumers may
// stumble on them but can't traverse to them.
//
// Per OKF v0.1 §5.3, broken links are explicitly NOT malformed (the spec
// is permissive). But "I have no inbound links" is a stronger signal —
// it means the concept is invisible to navigation. This checker flags
// such concepts as warnings, not errors.
//
// Usage:
//   node check-orphans.js <bundle-dir> [--json] [--strict] [--explain]
//
// --explain: print a hint per issue showing how to fix it.
//
// Exit codes: 0 = clean, 1 = errors (only in --strict), 2 = usage error.

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

// Strip a markdown link target to a concept ID (lowercased, no .md).
function normalizeTarget(raw) {
  let t = raw.split('#')[0].split('?')[0].trim();
  if (t === '' || /^(https?:|mailto:|urn:|tel:)/i.test(t)) return null;
  if (t.endsWith('.md')) t = t.slice(0, -3);
  return t.split(path.sep).join('/').toLowerCase();
}

// Extract all concept-ID link targets from a file, resolving relative paths.
function extractTargets(absPath, files, root) {
  const text = fs.readFileSync(absPath, 'utf8');
  const baseDir = path.relative(root, path.dirname(absPath)).split(path.sep).join('/');
  const targets = new Set();
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    if (raw.startsWith('/')) {
      const normalized = normalizeTarget(raw.replace(/^\/+/, ''));
      if (normalized) targets.add(normalized);
    } else {
      const resolved = path.posix.join(baseDir, raw);
      const normalized = normalizeTarget(resolved);
      if (normalized) targets.add(normalized);
    }
  }
  return targets;
}

function hintFor(msg, concept) {
  if (/no inbound links from any bundle file/.test(msg)) {
    return `Add a link to this concept from at least one other bundle file, e.g.:\n    * [Title](/${concept}.md)\nA natural home is the parent directory's index.md or a related concept's body.`;
  }
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { json: false, strict: false, explain: false };
  const positional = [];
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write([
        'Usage: check-orphans.js <bundle-dir> [--strict] [--json] [--explain]',
        '',
        'Finds concepts with no inbound links from any bundle file.',
        '',
        '--strict : promote orphan warnings to errors.',
        '--explain: print a hint per issue showing how to fix it.',
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

  // Build the set of all concept IDs in the bundle.
  const allConcepts = new Set();
  for (const abs of files) {
    const name = path.basename(abs);
    if (RESERVED.has(name.toLowerCase())) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/').toLowerCase().replace(/\.md$/, '');
    allConcepts.add(rel);
  }

  // Build the inbound-link map: for each concept ID, which files link to it?
  const inbound = new Map(); // concept-id (lowercased) -> Set<source-file-rel>
  for (const conceptId of allConcepts) inbound.set(conceptId, new Set());

  // Reserved files (index.md, log.md) can also be link targets — track them
  // but they're not "orphans" in the same sense.
  for (const abs of files) {
    const targets = extractTargets(abs, files, root);
    const srcRel = path.relative(root, abs).split(path.sep).join('/');
    for (const t of targets) {
      if (inbound.has(t)) {
        inbound.get(t).add(srcRel);
      }
    }
  }

  // Find concepts with no inbound links, excluding reserved filenames.
  const orphans = [];
  for (const conceptId of allConcepts) {
    if (inbound.get(conceptId).size === 0) {
      orphans.push({ level: 'warning', concept: conceptId, msg: 'no inbound links from any bundle file' });
    }
  }

  // Find self-referencing concepts (concept X links to itself) — useful diagnostic
  // but not an orphan if other files also link to it.
  const selfLinked = [];
  for (const abs of files) {
    const name = path.basename(abs);
    if (RESERVED.has(name.toLowerCase())) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const targets = extractTargets(abs, files, root);
    const selfId = rel.toLowerCase().replace(/\.md$/, '');
    if (targets.has(selfId)) {
      selfLinked.push({ file: rel });
    }
  }

  const summary = {
    concepts: allConcepts.size,
    orphans: orphans.length,
    self_linked: selfLinked.length,
  };

  if (opts.strict) {
    for (const it of orphans) it.level = 'error';
  }

  const issues = orphans;
  const errorCount = issues.filter((i) => i.level === 'error').length;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ root, summary, issues, self_linked: selfLinked }, null, 2) + '\n');
  } else {
    process.stdout.write(`OKF orphans — ${root}\n`);
    process.stdout.write(`  concepts: ${summary.concepts}\n`);
    process.stdout.write(`  orphans:  ${summary.orphans}\n`);
    process.stdout.write(`  self-linked: ${summary.self_linked}\n`);
    if (issues.length === 0) {
      process.stdout.write('  all good ✓\n');
    } else {
      for (const it of issues) {
        const tag = it.level === 'error' ? 'ERROR' : 'WARN ';
        process.stdout.write(`  [${tag}] ${it.concept}: ${it.msg}\n`);
        if (opts.explain) {
          const hint = hintFor(it.msg, it.concept);
          if (hint) {
            for (const line of hint.split('\n')) {
              process.stdout.write(`         hint: ${line}\n`);
            }
          }
        }
      }
    }
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

main();