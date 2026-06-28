#!/usr/bin/env node
// OKF prose-linkifier.
//
// Walks every `.md` file in a bundle, finds bare mentions of configured
// concepts/references in prose, and rewrites them as bundle-absolute
// markdown links. H1 titles, table rows, code fences, and the `# Cross-
// references` appendix are preserved unchanged.
//
// Usage:
//   node linkify-prose.js <bundle-dir> [--targets=<path-to-json>]
//                              [--dry-run] [--json]
//
// --targets: path to a JSON file mapping concept name (the bare
//   mention) to concept ID path (the link target). Defaults are
//   reasonable for any OKF bundle; override per-bundle.
//
// --dry-run: report what would change without writing.
//
// --json: emit a JSON report instead of text.
//
// Exit codes: 0 = success, 2 = usage error.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['index.md', 'log.md']);

const DEFAULT_TARGETS = {
  'PRD-0': 'prds/prd-0-overview.md',
  'PRD-1': 'prds/prd-1-crusade-master-admin.md',
  'PRD-2': 'prds/prd-2-player-signup.md',
  'PRD-3': 'prds/prd-3-army-export-versioning.md',
  'PRD-4': 'prds/prd-4-events-deltas.md',
  'PRD-5': 'prds/prd-5-approval-system.md',
};

function walkMd(root) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) hits.push(full);
    }
  }
  return hits;
}

function isTableRow(line) {
  const stripped = line.trimStart();
  if (!stripped.startsWith('|')) return false;
  // Heuristic: a markdown table row has at least two `|` chars after
  // the opening one. Header separator rows (`|---|---|`) count.
  return (stripped.match(/\|/g) || []).length >= 2;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function linkifyLine(line, sorted) {
  // Split on backtick runs so inline-code spans (`...`) are preserved
  // as-is. Odd-numbered segments are inside code; even-numbered are
  // prose. This handles `` `foo` ``, ``` ``foo`` ```, and matches by
  // paired backticks per CommonMark's basic rules.
  const parts = line.split(/(`+[^`]*?`+)/g);
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      // Inside backtick span — leave verbatim.
      result += part;
      continue;
    }
    let segment = part;
    // Mask out existing markdown links `[text](url)` so the regex
    // can't double-link needles that appear inside an existing link
    // text or URL. We replace each link with a placeholder of the
    // same length, run the regex, then restore the originals.
    const links = [];
    segment = segment.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => {
      const placeholder = '\x00'.repeat(m.length);
      links.push(m);
      return placeholder;
    });
    for (const [needle, target] of sorted) {
      const linkText = `[${needle}](${target.startsWith('/') ? target : '/' + target})`;
      // Skip if the new link text already appears verbatim (don't
      // duplicate identical links).
      const remaining = segment.replace(/\x00+/g, '');
      if (remaining.includes(linkText)) continue;
      // Word boundary on both sides: don't match inside longer
      // identifiers.
      const re = new RegExp(`(?<![\\w])${escapeRegex(needle)}(?![\\w])`, 'g');
      segment = segment.replace(re, linkText);
    }
    // Restore the masked links.
    for (const link of links) {
      segment = segment.replace(/\x00+/, link);
    }
    result += segment;
  }
  return result;
}

function countNewLinks(before, after, sorted) {
  // Count only the *specific* needles that turned into links. For each
  // needle, the increase in that needle's link form is the contribution.
  let total = 0;
  for (const [needle, target] of sorted) {
    const linkText = `[${needle}](${target.startsWith('/') ? target : '/' + target})`;
    const beforeCount = (before.match(new RegExp(escapeRegex(linkText), 'g')) || []).length;
    const afterCount = (after.match(new RegExp(escapeRegex(linkText), 'g')) || []).length;
    total += Math.max(0, afterCount - beforeCount);
  }
  return total;
}

function linkifyFile(absPath, sorted) {
  const text = fs.readFileSync(absPath, 'utf-8');

  // Split off frontmatter so we never touch it.
  let head = '';
  let body = text;
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---\n', 3);
    if (end !== -1) {
      head = text.slice(0, end + 5);
      body = text.slice(end + 5);
    }
  }

  // Preserve the `# Cross-references` appendix — it's hand-curated.
  const crIdx = body.indexOf('# Cross-references');
  const main = crIdx === -1 ? body : body.slice(0, crIdx);
  const appendix = crIdx === -1 ? '' : body.slice(crIdx);

  let changes = 0;
  const outLines = [];
  let inFence = false;
  let fenceMarker = '';
  for (const line of main.split(/\r?\n/)) {
    const stripped = line.trimStart();
    // Track fenced code blocks (``` or ~~~). Per CommonMark, the fence
    // char must be 3+ of the same char and only whitespace may precede
    // it on the line.
    const fenceMatch = stripped.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      outLines.push(line);
      continue;
    }
    if (inFence) { outLines.push(line); continue; }
    // Skip H1 file titles (`# PRD-N: ...`).
    if (/^#\s+PRD-\d\b/.test(stripped)) { outLines.push(line); continue; }
    // Skip table rows.
    if (isTableRow(line)) { outLines.push(line); continue; }

    const newLine = linkifyLine(line, sorted);
    changes += countNewLinks(line, newLine, sorted);
    outLines.push(newLine);
  }

  return {
    head,
    main: outLines.join('\n'),
    appendix,
    changes,
  };
}

function loadTargets(explicitPath) {
  if (!explicitPath) return { ...DEFAULT_TARGETS };
  let json;
  try { json = JSON.parse(fs.readFileSync(explicitPath, 'utf-8')); }
  catch (e) {
    process.stderr.write(`error: cannot read targets file ${explicitPath}: ${e.message}\n`);
    process.exit(2);
  }
  return { ...DEFAULT_TARGETS, ...json };
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { dryRun: false, json: false, targets: null };
  const positional = [];
  for (const a of argv) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--targets=')) opts.targets = a.slice('--targets='.length);
    else if (a === '-h' || a === '--help') {
      process.stdout.write([
        'Usage: linkify-prose.js <bundle-dir> [--targets=<json>] [--dry-run] [--json]',
        '',
        'Walks every .md file in the bundle and converts bare mentions of',
        'configured concepts into bundle-absolute markdown links.',
        '',
        '--targets: path to a JSON file mapping "bare mention" -> "concept ID path".',
        '           May be with or without the leading "/".',
        '           Defaults to a reasonable set of common OKF concepts.',
        '',
        '--dry-run: report changes without writing to disk.',
        '--json:    emit a JSON report of changes per file.',
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

  const targets = loadTargets(opts.targets);
  const sorted = Object.entries(targets).sort((a, b) => b[0].length - a[0].length);
  const files = walkMd(root);
  const report = [];
  let totalChanges = 0;

  for (const abs of files) {
    const name = path.basename(abs);
    if (RESERVED.has(name.toLowerCase())) continue;
    const result = linkifyFile(abs, sorted);
    if (result.changes > 0) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      report.push({ file: rel, changes: result.changes });
      totalChanges += result.changes;
      if (!opts.dryRun) {
        const tail = result.appendix.endsWith('\n') || result.appendix === '' ? '' : '\n';
        fs.writeFileSync(abs, result.head + result.main + result.appendix + tail, 'utf-8');
      }
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ root, totalChanges, files: report }, null, 2) + '\n');
  } else {
    process.stdout.write(`OKF linkify-prose${opts.dryRun ? ' (dry-run)' : ''} — ${root}\n`);
    process.stdout.write(`  files touched: ${report.length}\n`);
    process.stdout.write(`  total changes: ${totalChanges}\n`);
    if (report.length === 0) {
      process.stdout.write('  nothing to do\n');
    } else {
      for (const r of report) {
        process.stdout.write(`  ${r.file}: ${r.changes} link(s)\n`);
      }
    }
  }
}

main();