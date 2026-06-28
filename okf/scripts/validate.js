#!/usr/bin/env node
// OKF (Open Knowledge Format) v0.1 conformance validator
// Walks a bundle directory, parses frontmatter from each .md file, and
// reports conformance issues. Exit code 0 = no errors, 1 = errors found.
//
// Usage:
//   node validate.js <bundle-dir> [--strict] [--check-links] [--json]
//                          [--explain]
//
// --explain: for each issue, print a hint showing what to add or how
//            to fix it.
//
// Scope is intentionally limited to OKF v0.1 hard conformance (§9 of SPEC.md):
//   1. Every non-reserved .md file has a parseable YAML frontmatter block.
//   2. Every frontmatter block has a non-empty `type` field.
//   3. Reserved filenames (index.md, log.md) follow §6 / §7 structure
//      when present.
// Recommended-but-optional fields are reported as warnings, not errors.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['index.md', 'log.md']);

// ---- minimal YAML-frontmatter subset parser ---------------------------------
// The OKF spec only requires us to verify that the frontmatter is parseable
// and that `type` is present and non-empty. We support the subset of YAML
// that the spec actually defines: scalars, inline lists `[a, b]`, and
// block lists. Anything richer is fine — we just won't try to interpret it.

function parseScalar(s) {
  if (s == null) return null;
  s = s.trim();
  if (s === '' || s === '~' || s.toLowerCase() === 'null') return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(text) {
  // Frontmatter must start at byte 0 with `---` on its own line.
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { ok: false, reason: 'no frontmatter block (missing leading `---`)' };
  const block = m[1];
  const result = {};
  let currentKey = null;
  let currentIsList = false;
  const lines = block.split(/\r?\n/);

  for (const raw of lines) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;

    // Inline list under current key, e.g. `  - foo`
    const listItem = raw.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey && currentIsList) {
      result[currentKey].push(parseScalar(listItem[1]));
      continue;
    }

    // New key
    const kv = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) {
      // Indented continuation we don't understand — skip rather than fail.
      continue;
    }
    const [, key, rawVal] = kv;
    const val = rawVal.trim();
    if (val === '' || val === '|' || val === '>') {
      // Could be block scalar or list — assume list, will be populated by following `- ` lines.
      result[key] = [];
      currentIsList = true;
    } else if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      result[key] = inner === '' ? [] : inner.split(',').map((s) => parseScalar(s));
      currentIsList = false;
    } else {
      result[key] = parseScalar(val);
      currentIsList = false;
    }
    currentKey = key;
  }
  return { ok: true, data: result };
}

// ---- link extraction (very loose) ------------------------------------------
// We only care about markdown links whose target is a .md file in the bundle.
// This lets us warn about broken internal links without being clever about
// every markdown construct.

function extractMdLinks(text) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = m[1].split('#')[0].split('?')[0].trim();
    if (target === '' || target.startsWith('http://') || target.startsWith('https://')) continue;
    if (target.startsWith('mailto:')) continue;
    // Skip directory-style links — they navigate to a subdirectory's index.md,
    // not a concept document. The spec (§5) only defines concept-to-concept links.
    if (target.endsWith('/')) continue;
    // Skip non-markdown file references — the link checker only knows about
    // concept documents (.md). Scripts (.js), JSON, images, etc. are out of scope.
    if (/\.(js|json|yml|yaml|toml|html|png|jpg|jpeg|gif|svg|pdf|css)$/i.test(target)) continue;
    out.push(target);
  }
  return out;
}

// ---- validators ------------------------------------------------------------

function walkMd(root) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) hits.push(full);
    }
  }
  return hits;
}

function validateLogFile(absPath) {
  const issues = [];
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return [{ level: 'error', msg: `cannot read: ${e.message}` }];
  }
  // log.md files MUST NOT have frontmatter (§7 of the spec).
  if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
    issues.push({ level: 'error', msg: 'log.md MUST NOT contain frontmatter (§7)' });
  }
  // Date headings MUST be `## YYYY-MM-DD`.
  const re = /^##\s+(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const heading = m[1].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(heading)) {
      issues.push({ level: 'error', msg: `log date heading must be ISO 8601 YYYY-MM-DD, got: "${heading}"` });
    }
  }
  return issues;
}

function validateIndexFile(absPath, isRoot) {
  const issues = [];
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return [{ level: 'error', msg: `cannot read: ${e.message}` }];
  }
  // index.md files MUST NOT have frontmatter — except that a bundle-root
  // index.md MAY carry `okf_version` (§11). Treat the root case permissively.
  if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
    if (!isRoot) {
      issues.push({ level: 'error', msg: 'index.md MUST NOT contain frontmatter (§6), except optionally in the bundle root' });
    } else {
      // Root index.md frontmatter is allowed only if the only key is okf_version
      // and possibly a handful of version-related keys. Be lenient: warn if
      // there are non-okf keys.
      const fm = parseFrontmatter(text);
      if (!fm.ok) {
        issues.push({ level: 'warning', msg: `bundle-root index.md frontmatter is unparseable: ${fm.reason}` });
      } else {
        for (const k of Object.keys(fm.data)) {
          if (k !== 'okf_version') {
            issues.push({ level: 'warning', msg: `bundle-root index.md frontmatter has non-okf key "${k}" (spec allows okf_version only)` });
          }
        }
      }
    }
  }
  return issues;
}

function validateConceptFile(absPath) {
  const issues = [];
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return [{ level: 'error', msg: `cannot read: ${e.message}` }];
  }
  const fm = parseFrontmatter(text);
  if (!fm.ok) {
    issues.push({ level: 'error', msg: fm.reason });
    return issues;
  }
  const data = fm.data || {};
  // Hard conformance rule 2: non-empty `type`.
  if (!('type' in data) || data.type == null || String(data.type).trim() === '') {
    issues.push({ level: 'error', msg: 'missing or empty required field `type`' });
  } else {
    // Soft guidance: warn if recommended fields are missing.
    for (const f of ['title', 'description']) {
      if (!(f in data) || data[f] == null || String(data[f]).trim() === '') {
        issues.push({ level: 'warning', msg: `missing recommended field \`${f}\`` });
      }
    }
    if ('timestamp' in data && data.timestamp) {
      if (isNaN(Date.parse(String(data.timestamp)))) {
        issues.push({ level: 'warning', msg: `\`timestamp\` is not a valid ISO 8601 datetime: ${data.timestamp}` });
      }
    }
    if ('tags' in data && data.tags != null && !Array.isArray(data.tags)) {
      issues.push({ level: 'warning', msg: '`tags` should be a YAML list' });
    }
  }
  return issues;
}

function checkLinks(root, files) {
  const issues = [];
  // Build a set of bundle-relative concept IDs (lowercased, no .md suffix).
  // Per spec §2, a concept ID is the file path with `.md` removed.
  const present = new Set(
    files.map((f) => path.relative(root, f).split(path.sep).join('/').toLowerCase().replace(/\.md$/, ''))
  );
  for (const abs of files) {
    const base = path.relative(root, path.dirname(abs)).split(path.sep).join('/');
    const text = fs.readFileSync(abs, 'utf8');
    const links = extractMdLinks(text);
    for (const link of links) {
      // Resolve relative to the linking file.
      let resolved = link;
      if (!resolved.startsWith('/')) {
        resolved = path.posix.join(base, resolved);
      } else {
        resolved = resolved.replace(/^\/+/, '');
      }
      // Normalize: drop trailing .md (per spec §5.1, link may omit suffix).
      resolved = resolved.toLowerCase();
      if (resolved.endsWith('.md')) resolved = resolved.slice(0, -3);
      if (!present.has(resolved)) {
        issues.push({ level: 'warning', file: path.relative(root, abs), msg: `broken internal link: ${link}` });
      }
    }
  }
  return issues;
}

// ---- main ------------------------------------------------------------------

// Per-issue hints for `--explain` mode.
function hintFor(msg) {
  if (/no frontmatter block/.test(msg))
    return 'Add a YAML frontmatter block at the top of the file:\n  ---\n  type: <Type Name>\n  ---';
  if (/`type` is required/.test(msg))
    return 'Add a non-empty `type:` field to the frontmatter (e.g. `type: PRD`)';
  if (/frontmatter block is empty/.test(msg))
    return 'The frontmatter has `---` delimiters but no content; add at least `type: <Name>`';
  if (/frontmatter block must end/.test(msg))
    return 'Add a closing `---` line after the frontmatter keys';
  if (/non-root index.md MUST NOT contain frontmatter/.test(msg))
    return 'Remove the frontmatter block from this index.md (only the bundle root index.md may have frontmatter per §6)';
  if (/frontmatter key .+ is empty/.test(msg))
    return 'Provide a value for this key, or remove the key entirely';
  if (/top-level heading must be present/.test(msg))
    return 'Add a `# Title` heading as the first non-frontmatter content';
  if (/non-date heading/.test(msg))
    return 'log.md headings MUST be `## YYYY-MM-DD`. Use `### sub-heading` for sub-sections instead';
  if (/date heading must be ISO 8601/.test(msg))
    return 'Use the format `## YYYY-MM-DD` (e.g. `## 2026-06-28`)';
  if (/broken internal link/.test(msg))
    return 'Either create the target concept file, or fix the link path. Per §5.3 broken links are warnings only.';
  if (/link target must end in \.md/.test(msg))
    return 'Internal links in OKF should end in `.md` (e.g. `/tables/orders.md`)';
  if (/cannot read/.test(msg))
    return 'Check file permissions and that the file is readable';
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { strict: false, checkLinks: false, json: false, explain: false };
  const positional = [];
  for (const a of argv) {
    if (a === '--strict') opts.strict = true;
    else if (a === '--check-links') opts.checkLinks = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write([
        'Usage: validate.js <bundle-dir> [--strict] [--check-links] [--json]',
        '                       [--explain]',
        '',
        'OKF v0.1 §9 conformance validator.',
        '',
        '--strict      : promote warnings to errors.',
        '--check-links : additionally walk every internal .md link.',
        '--json        : emit JSON instead of text.',
        '--explain     : print a hint per issue showing how to fix it.',
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
  const summary = { concepts: 0, indexes: 0, logs: 0, errors: 0, warnings: 0 };

  for (const abs of files) {
    const rel = path.relative(root, abs);
    const name = path.basename(abs);
    let fileIssues = [];
    if (RESERVED.has(name.toLowerCase())) {
      if (name.toLowerCase() === 'log.md') {
        summary.logs++;
        fileIssues = validateLogFile(abs);
      } else {
        summary.indexes++;
        const isRoot = path.dirname(abs) === root;
        fileIssues = validateIndexFile(abs, isRoot);
      }
    } else {
      summary.concepts++;
      fileIssues = validateConceptFile(abs);
    }
    for (const it of fileIssues) {
      allIssues.push({ file: rel, ...it });
    }
  }

  if (opts.checkLinks) {
    for (const it of checkLinks(root, files)) {
      allIssues.push(it);
    }
  }

  // In --strict mode, warnings are promoted to errors.
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
    process.stdout.write(`OKF validate — ${root}\n`);
    process.stdout.write(`  concepts: ${summary.concepts}  indexes: ${summary.indexes}  logs: ${summary.logs}\n`);
    process.stdout.write(`  errors:   ${summary.errors}  warnings: ${summary.warnings}\n`);
    if (allIssues.length === 0) {
      process.stdout.write('  all good ✓\n');
    } else {
      for (const it of allIssues) {
        const tag = it.level === 'error' ? 'ERROR' : 'WARN ';
        process.stdout.write(`  [${tag}] ${it.file}: ${it.msg}\n`);
        if (opts.explain) {
          const hint = hintFor(it.msg);
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
