#!/usr/bin/env node
// OKF concept author.
//
// Reads a source markdown file (typically a PRD or a domain-expert
// prose draft) and emits an OKF concept file with structured
// frontmatter and a `# Cross-references` appendix appended.
//
// Usage:
//   node author-concepts.js <source.md> <output.md> --metadata=<json>
//                          [--refs=<json>] [--no-append]
//
// --metadata: REQUIRED. JSON with frontmatter fields. Recognized keys:
//   - type (required; e.g. "PRD", "Domain Concept", "Reference")
//   - title (recommended)
//   - description (recommended)
//   - resource (optional canonical URI for the concept)
//   - tags (optional array; rendered as YAML list)
//   - timestamp (optional ISO 8601; defaults to "now" if omitted)
//   - id (optional concept ID; defaults to <output>.md path with .md
//        stripped)
//
// --refs: optional JSON mapping concept-name (display) -> concept-id
//         (path). Used to build the cross-references appendix. Names
//         in the source body are matched against this map and listed
//         in the appendix.
//
// --no-append: skip the cross-references appendix (useful when
//         rebuilding concepts that already have hand-curated
//         appendices).
//
// Exit codes: 0 = success, 2 = usage error, 3 = metadata missing
// required fields.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const opts = { metadata: null, refs: null, append: true };
  const positional = [];
  for (const a of argv) {
    if (a === '--no-append') opts.append = false;
    else if (a.startsWith('--metadata=')) opts.metadata = a.slice('--metadata='.length);
    else if (a.startsWith('--refs=')) opts.refs = a.slice('--refs='.length);
    else if (a === '-h' || a === '--help') {
      process.stdout.write([
        'Usage: author-concepts.js <source.md> <output.md> --metadata=<json>',
        '                             [--refs=<json>] [--no-append]',
        '',
        'Reads a source markdown file and writes an OKF concept file',
        'with frontmatter and a Cross-references appendix.',
        '',
        '--metadata=<json>: required. Frontmatter fields. Required: type.',
        '                    Recommended: title, description, tags, resource.',
        '--refs=<json>: optional. Maps concept-name -> concept-id for the',
        '                appendix. Names listed here will appear under',
        '                "# Cross-references" with link markup.',
        '--no-append: skip the appendix.',
      ].join('\n') + '\n');
      process.exit(0);
    } else positional.push(a);
  }
  if (positional.length < 2) {
    process.stderr.write('error: source and output paths required\n');
    process.exit(2);
  }
  opts.source = positional[0];
  opts.output = positional[1];
  return opts;
}

function loadJson(value, label) {
  // If value looks like a path (doesn't start with `{` or `[`), try
  // reading it as a file first. Otherwise treat as inline JSON.
  let raw;
  if (!/^[\{\[]/.test(value.trim())) {
    try { raw = fs.readFileSync(value, 'utf-8'); }
    catch (e) {
      process.stderr.write(`error: cannot read --${label} file ${value}: ${e.message}\n`);
      process.exit(2);
    }
  } else {
    raw = value;
  }
  try { return JSON.parse(raw); }
  catch (e) {
    process.stderr.write(`error: invalid JSON for --${label}: ${e.message}\n`);
    process.exit(2);
  }
}

function loadJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) {
    process.stderr.write(`error: cannot read --refs file ${p}: ${e.message}\n`);
    process.exit(2);
  }
}

function renderFrontmatter(meta, id) {
  const fm = {};
  if (meta.type) fm.type = meta.type;
  if (meta.title) fm.title = meta.title;
  if (meta.description) fm.description = meta.description;
  if (meta.resource) fm.resource = meta.resource;
  if (meta.tags && Array.isArray(meta.tags) && meta.tags.length) fm.tags = meta.tags;
  if (meta.timestamp) fm.timestamp = meta.timestamp;
  else fm.timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (id) fm.id = id;
  // Render as YAML.
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function yamlScalar(s) {
  // Quote if contains `:`, `#`, leading/trailing whitespace, or starts
  // with a YAML control character. Otherwise leave bare.
  if (/[:#]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function renderAppendix(refs) {
  if (!refs || Object.keys(refs).length === 0) return '';
  const lines = ['# Cross-references', ''];
  // Sort by display name for stable output.
  const entries = Object.entries(refs).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, target] of entries) {
    const linkTarget = target.startsWith('/') ? target : '/' + target;
    lines.push(`- [${name}](${linkTarget})`);
  }
  lines.push('');  // trailing newline
  return lines.join('\n');
}

function stripExistingFrontmatterAndAppendix(text) {
  let body = text;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---\n', 3);
    if (end !== -1) body = body.slice(end + 5);
  }
  // Drop existing `# Cross-references` appendix if present (we'll
  // regenerate).
  const idx = body.indexOf('# Cross-references');
  if (idx !== -1) body = body.slice(0, idx).replace(/\s+$/, '');
  return body;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.metadata) {
    process.stderr.write('error: --metadata required\n');
    process.exit(2);
  }
  const meta = loadJson(opts.metadata, 'metadata');
  if (!meta.type) {
    process.stderr.write('error: --metadata must include "type"\n');
    process.exit(3);
  }
  const refs = opts.refs ? loadJsonFile(opts.refs) : null;

  if (!fs.existsSync(opts.source)) {
    process.stderr.write(`error: source file does not exist: ${opts.source}\n`);
    process.exit(2);
  }

  // Derive concept ID from the output path: strip leading dirs and
  // the .md suffix. E.g. "prds/prd-3-army-export-versioning.md" →
  // "prds/prd-3-army-export-versioning".
  const outPath = path.resolve(opts.output);
  const id = meta.id || path.relative(process.cwd(), outPath).replace(/\.md$/, '');

  const sourceText = fs.readFileSync(opts.source, 'utf-8');
  const body = stripExistingFrontmatterAndAppendix(sourceText);

  const fm = renderFrontmatter(meta, id);
  const appendix = opts.append ? renderAppendix(refs) : '';

  // body ends without trailing newline after trim(); always use a
  // blank-line separator so the appendix renders as a new H1.
  const trimmedBody = body.replace(/\s+$/, '');
  const sep = appendix ? '\n\n' : '';

  const output = `${fm}\n\n${trimmedBody}${sep}${appendix}\n`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, 'utf-8');

  process.stdout.write(`OKF author-concepts — wrote ${outPath}\n`);
  process.stdout.write(`  type: ${meta.type}\n`);
  process.stdout.write(`  id: ${id}\n`);
  process.stdout.write(`  body lines: ${body.split(/\r?\n/).length}\n`);
  if (refs) process.stdout.write(`  cross-refs: ${Object.keys(refs).length}\n`);
}

main();