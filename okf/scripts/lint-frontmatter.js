#!/usr/bin/env node
// OKF frontmatter linter — strict schema check per `type`.
//
// OKF v0.1 §4.1 says only `type` is required. This linter goes further: it
// warns when any of the 5 recommended fields (`title`, `description`,
// `resource`, `tags`, `timestamp`) are missing, and errors on
// malformed values for fields that have a shape constraint.
//
// Scope: every non-reserved `.md` file in the bundle.
//
// Usage:
//   node lint-frontmatter.js <bundle-dir> [--strict] [--json]
//                              [--explain] [--fix]
//
// --explain : for each issue, print a hint showing what to add or how
//             to fix it. Combine with --strict to explain errors.
// --fix     : auto-fix safe issues in-place:
//               * trim trailing whitespace from string fields
//               * strip empty list entries
//             Other issues are still reported (not silently changed).
//             Files are rewritten with the same frontmatter + body.
//
// Exit codes: 0 = clean, 1 = errors found, 2 = usage error.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['index.md', 'log.md']);

// Per-`type` required-vs-recommended field expectations.
// The spec requires `type` (already enforced by validate.js); this linter
// requires all RECOMMENDED fields per §4.1, with a warning tier.
const SCHEMA = {
  recommended: ['title', 'description', 'resource', 'tags', 'timestamp'],
  // Some `type` values are abstract (no `resource` URI makes sense).
  // For now, all types are treated equally — every concept gets all 5.
};

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { ok: false, reason: 'no frontmatter block' };
  const block = m[1];
  const out = {};
  let currentKey = null;
  let currentIsList = false;
  for (const raw of block.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const listItem = raw.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey && currentIsList) {
      out[currentKey].push(scalar(listItem[1]));
      continue;
    }
    const kv = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawVal] = kv;
    const val = rawVal.trim();
    if (val === '' || val === '|' || val === '>') {
      out[key] = [];
      currentIsList = true;
    } else if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      out[key] = inner === '' ? [] : inner.split(',').map((s) => scalar(s));
      currentIsList = false;
    } else {
      out[key] = scalar(val);
      currentIsList = false;
    }
    currentKey = key;
  }
  return { ok: true, data: out };
}

function scalar(s) {
  if (s == null) return null;
  s = s.trim();
  if (s === '' || s === '~' || s.toLowerCase() === 'null') return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function isValidIso8601(s) {
  if (typeof s !== 'string') return false;
  // Accept full ISO 8601 with timezone (Z or +HH:MM) OR bare date YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function isValidUri(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  // Accept http(s)://, urn:, or path-style like bigquery:project.dataset.table.
  if (/^https?:\/\//i.test(s)) return true;
  if (/^urn:/i.test(s)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return true;
  return false;
}

// Per-issue hints for `--explain` mode.
function hintFor(msg) {
  if (/missing recommended field `title`/.test(msg))
    return 'Add a short human-readable name: `title: <Name>`';
  if (/missing recommended field `description`/.test(msg))
    return 'Add a one-sentence summary: `description: <text>`';
  if (/missing recommended field `resource`/.test(msg))
    return 'Add a canonical URI for the concept: `resource: https://...` (or `urn:...`)';
  if (/missing recommended field `tags`/.test(msg))
    return 'Add a YAML list of tags, e.g.:\n    tags:\n      - tag1\n      - tag2';
  if (/missing recommended field `timestamp`/.test(msg))
    return 'Add an ISO 8601 timestamp: `timestamp: YYYY-MM-DD` or `timestamp: YYYY-MM-DDTHH:MM:SSZ`';
  if (/`tags` should be a YAML list/.test(msg))
    return 'Convert to YAML list syntax:\n    tags:\n      - a\n      - b\n(not `tags: [a, b]` — that is JSON, not YAML)';
  if (/`timestamp` is not ISO 8601/.test(msg))
    return 'Use one of: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SSZ`, or `YYYY-MM-DDTHH:MM:SS+HH:MM`';
  if (/`resource` is not a valid URI/.test(msg))
    return 'Provide an http(s):// URL, a urn: URI, or a scheme:path identifier';
  if (/`title` is unusually long/.test(msg))
    return 'Consider shortening the title (≤ ~80 chars works best in indexes)';
  if (/`description` is unusually long/.test(msg))
    return 'Move long-form text into the body; keep the description a single sentence';
  if (/`tags` has \d+ entries/.test(msg))
    return 'Aim for ≤ 10 tags; split into more specific concepts instead';
  return 'Review the field\'s schema requirement';
}

// Safe auto-fixers for `--fix` mode. Each takes the frontmatter object
// (mutated in place) and returns true if it changed anything.
function autoFix(data) {
  let changed = false;
  for (const k of ['title', 'description', 'resource', 'timestamp']) {
    if (typeof data[k] === 'string') {
      const trimmed = data[k].replace(/\s+$/g, '').replace(/^\s+/g, '');
      if (trimmed !== data[k]) { data[k] = trimmed; changed = true; }
    }
  }
  if (Array.isArray(data.tags)) {
    const cleaned = data.tags.filter((t) => t != null && String(t).trim() !== '');
    if (cleaned.length !== data.tags.length) { data.tags = cleaned; changed = true; }
  }
  return changed;
}

function renderFrontmatter(data) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${JSON.stringify(String(item))}`);
    } else if (v == null) {
      lines.push(`${k}:`);
    } else {
      lines.push(`${k}: ${JSON.stringify(String(v))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

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

function lintFile(absPath) {
  const issues = [];
  let text;
  try { text = fs.readFileSync(absPath, 'utf8'); }
  catch (e) { return [{ level: 'error', msg: `cannot read: ${e.message}` }]; }

  const fm = parseFrontmatter(text);
  if (!fm.ok) return [{ level: 'error', msg: fm.reason }]; // already caught by validate.js

  const data = fm.data;
  for (const f of SCHEMA.recommended) {
    if (!(f in data) || data[f] == null || (typeof data[f] === 'string' && data[f].trim() === '')) {
      issues.push({ level: 'warning', msg: `missing recommended field \`${f}\`` });
    }
  }

  // Shape checks (errors)
  if ('tags' in data && data.tags != null && !Array.isArray(data.tags)) {
    issues.push({ level: 'error', msg: '`tags` should be a YAML list, got ' + typeof data.tags });
  }
  if ('timestamp' in data && data.timestamp != null && !isValidIso8601(String(data.timestamp))) {
    issues.push({ level: 'error', msg: `\`timestamp\` is not ISO 8601: ${data.timestamp}` });
  }
  if ('resource' in data && data.resource != null && String(data.resource).trim() !== '' && !isValidUri(String(data.resource))) {
    issues.push({ level: 'error', msg: `\`resource\` is not a valid URI: ${data.resource}` });
  }
  if ('title' in data && data.title != null && String(data.title).length > 200) {
    issues.push({ level: 'warning', msg: `\`title\` is unusually long (${String(data.title).length} chars)` });
  }
  if ('description' in data && data.description != null && String(data.description).length > 500) {
    issues.push({ level: 'warning', msg: `\`description\` is unusually long (${String(data.description).length} chars)` });
  }
  if ('tags' in data && Array.isArray(data.tags) && data.tags.length > 20) {
    issues.push({ level: 'warning', msg: `\`tags\` has ${data.tags.length} entries (> 20)` });
  }
  return issues;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { strict: false, json: false, explain: false, fix: false };
  const positional = [];
  for (const a of argv) {
    if (a === '--strict') opts.strict = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '--fix') opts.fix = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write([
        'Usage: lint-frontmatter.js <bundle-dir> [--strict] [--json]',
        '                                  [--explain] [--fix]',
        '',
        'OKF frontmatter linter — checks the 5 recommended fields per',
        'concept (title, description, resource, tags, timestamp).',
        '',
        '--strict : promote warnings to errors (CI gate).',
        '--json   : emit JSON instead of text.',
        '--explain: print a hint per issue showing what to add/fix.',
        '--fix    : auto-fix safe issues (trailing whitespace, empty',
        '           list entries) in-place. Other issues are still',
        '           reported.',
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
  const allIssues = [];
  const summary = { concepts: 0, warnings: 0, errors: 0, fixedFiles: 0 };

  for (const abs of files) {
    const name = path.basename(abs);
    if (RESERVED.has(name.toLowerCase())) continue;
    summary.concepts++;
    const fileIssues = lintFile(abs);
    for (const it of fileIssues) {
      allIssues.push({ file: path.relative(root, abs), ...it });
    }

    // --fix: rewrite the file with safe auto-fixes applied.
    if (opts.fix) {
      const text = fs.readFileSync(abs, 'utf8');
      const fm = parseFrontmatter(text);
      if (fm.ok) {
        const data = { ...fm.data };
        if (autoFix(data)) {
          // Reconstruct the file: frontmatter + body (everything after
          // the closing `---`).
          const end = text.indexOf('\n---\n', 3);
          if (end !== -1) {
            const body = text.slice(end + 5);
            fs.writeFileSync(abs, renderFrontmatter(data) + '\n' + body, 'utf8');
            summary.fixedFiles++;
          }
        }
      }
    }
  }

  if (opts.strict) {
    for (const it of allIssues) {
      if (it.level === 'warning') it.level = 'error';
    }
  }

  for (const it of allIssues) {
    if (it.level === 'error') summary.errors++;
    else summary.warnings++;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ root, summary, issues: allIssues }, null, 2) + '\n');
  } else {
    process.stdout.write(`OKF frontmatter lint — ${root}\n`);
    process.stdout.write(`  concepts: ${summary.concepts}\n`);
    process.stdout.write(`  errors:   ${summary.errors}  warnings: ${summary.warnings}\n`);
    if (opts.fix && summary.fixedFiles) {
      process.stdout.write(`  fixed:    ${summary.fixedFiles} file(s)\n`);
    }
    if (allIssues.length === 0) {
      process.stdout.write('  all good ✓\n');
    } else {
      for (const it of allIssues) {
        const tag = it.level === 'error' ? 'ERROR' : 'WARN ';
        process.stdout.write(`  [${tag}] ${it.file}: ${it.msg}\n`);
        if (opts.explain) {
          for (const line of hintFor(it.msg).split('\n')) {
            process.stdout.write(`         hint: ${line}\n`);
          }
        }
      }
    }
  }

  process.exit(summary.errors > 0 ? 1 : 0);
}

main();