#!/usr/bin/env node
// Snapshot of the Route Optimization service surface the skills rely on, and a diff against the committed baseline.
//
// It reads routeoptimization-agent at the commit of its latest successful prod MCP server deployment, through
// `gh api` and the GitHub access this host already has. It contacts nothing but GitHub and never the live service.
//
//   node scripts/drift/snapshot.mjs            markdown drift report; exit 0 no drift, 1 drift, 2 parse failure
//   node scripts/drift/snapshot.mjs --write    refresh drift/service-surface.json
//
// --source-dir <dir> [--commit <sha>] reads a local checkout instead of GitHub. --baseline <file> and
// --skills-dir <dir> override the baseline file and the skills scanned for mentions.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const SERVICE_REPO = 'homecareintel/routeoptimization-agent';

const JAVA = 'mcp-server/src/main/java/com/hci/routeoptimization/mcp';
const RESOURCES = 'mcp-server/src/main/resources';
export const PATHS = {
  toolsDir: `${JAVA}/tools`,
  features: `${JAVA}/config/McpFeaturesConfiguration.java`,
  settingsTools: `${JAVA}/tools/SettingsTools.java`,
  errorCode: `${JAVA}/ops/ErrorCode.java`,
  runStatus: `${JAVA}/runs/RunStatus.java`,
  proposalStatus: `${JAVA}/profile/ProposalStatus.java`,
  runOps: `${JAVA}/ops/RunOps.java`,
  runRecord: `${JAVA}/runs/RunRecord.java`,
  checklistsDir: `${RESOURCES}/checklists`,
  applicationYml: `${RESOURCES}/application.yml`,
  protocolTest: 'mcp-server/src/test/java/com/hci/routeoptimization/mcp/e2e/McpProtocolTest.java',
};

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_BASELINE = join(REPO_ROOT, 'drift/service-surface.json');
const DEFAULT_SKILLS = join(REPO_ROOT, 'skills');

const HINTS = ['readOnly', 'destructive', 'idempotent', 'openWorld'];
const STATUS_SETS = {
  runStatuses: 'run statuses',
  proposalStatuses: 'proposal statuses',
  compileProfileStates: 'compile profile states',
  runFailureCodes: 'run failure codes',
};

export class ParseError extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

// ---- readers: { repo, commit, read(path) -> text | null, list(dir) -> file names | null } ----

/** Reads a local checkout (or a fixture tree laid out like one). */
export function dirReader(root, commit = 'local') {
  return {
    repo: SERVICE_REPO,
    commit,
    read(path) {
      try {
        return readFileSync(join(root, path), 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'EISDIR') return null;
        throw e;
      }
    },
    list(dir) {
      try {
        return readdirSync(join(root, dir), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort();
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

function gh(args) {
  try {
    return execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (/HTTP 404/.test(e.stderr ?? '')) return null;
    throw new Error(`gh api ${args.at(-1)} failed: ${(e.stderr || e.message).trim()}`);
  }
}

// The service's deploy workflow applies more than one app to the prod environment, and every apply job records a
// prod deployment. Only a deployment made by the job that applies the MCP server names the commit prod serves.
const MCP_DEPLOY_JOB = /\bApply mcp \(prod\)$/;

/**
 * The commit of the newest prod deployment whose latest status is success and whose Actions job applied the MCP
 * server. `api(args)` returns the `gh api` response body, or null on 404.
 */
export function prodCommit(repo, api = gh) {
  const deployments = JSON.parse(api([`repos/${repo}/deployments?environment=prod&per_page=100`]) ?? '[]')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const d of deployments) {
    const [latest] = JSON.parse(api([`repos/${repo}/deployments/${d.id}/statuses?per_page=1`]) ?? '[]');
    if (latest?.state !== 'success') continue;
    const jobId = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(latest.log_url || latest.target_url || '')?.[1];
    const job = jobId ? JSON.parse(api([`repos/${repo}/actions/jobs/${jobId}`]) ?? 'null') : null;
    if (!job?.name) {
      throw new Error(`cannot tell which app successful prod deployment ${d.id} of ${repo} applied: its Actions job is not readable`);
    }
    if (MCP_DEPLOY_JOB.test(job.name)) return d.sha;
  }
  throw new Error(`no successful MCP server deployment among the newest ${deployments.length} prod deployments of ${repo}`);
}

/** Reads the service repo through `gh api` at its prod-deployed commit. */
export function ghReader(repo = SERVICE_REPO) {
  const commit = prodCommit(repo);
  const contents = (path) => `repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`;
  return {
    repo,
    commit,
    read: (path) => gh(['-H', 'Accept: application/vnd.github.raw+json', contents(path)]),
    list(dir) {
      const body = gh([contents(dir)]);
      const entries = body == null ? null : JSON.parse(body);
      return Array.isArray(entries) ? entries.filter((e) => e.type === 'file').map((e) => e.name).sort() : null;
    },
  };
}

// ---- Java source scanning ----

/** Index just past the string, char or text-block literal that starts at i. */
function literalEnd(src, i) {
  if (src.startsWith('"""', i)) {
    for (let j = i + 3; j < src.length; j++) {
      if (src[j] === '\\') j++;
      else if (src.startsWith('"""', j)) return j + 3;
    }
    return src.length;
  }
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** The source with comments blanked out; literals kept as written. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      out += ' ';
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
    } else if (src[i] === '"' || src[i] === "'") {
      const end = literalEnd(src, i);
      out += src.slice(i, end);
      i = end;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** Index of the bracket closing the one at `open`, skipping literals; -1 if unbalanced. */
function closing(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") i = literalEnd(src, i) - 1;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && --depth === 0) return i;
  }
  return -1;
}

/** Splits at `sep` outside literals and brackets; stops at a top-level `stop` character. */
function splitTopLevel(text, sep = ',', stop = null) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = literalEnd(text, i) - 1;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === stop) return { parts: [...parts, text.slice(start, i)], stopped: true };
    else if (depth === 0 && c === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return stop ? { parts, stopped: false } : parts;
}

function unescapeJava(s) {
  const simple = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', s: ' ' };
  return s.replace(/\\(u+[0-9a-fA-F]{4}|[0-7]{1,3}|.)/g, (_, e) => {
    if (e[0] === 'u') return String.fromCharCode(parseInt(e.replace(/^u+/, ''), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return simple[e] ?? e;
  });
}

const STRING = /^"(?:[^"\\\n]|\\.)*"$/;

/** The value of `"a" + "b"`, or null when the expression is anything but string literals. */
function stringExpr(text) {
  let out = '';
  for (const part of splitTopLevel(text, '+').map((p) => p.trim())) {
    if (!STRING.test(part)) return null;
    out += unescapeJava(part.slice(1, -1));
  }
  return out;
}

/** The `.method(args)` calls chained after index i. */
function chainedCalls(code, i) {
  const calls = [];
  const call = /^\s*\.\s*(?:<[^>]*>\s*)?(\w+)\s*\(/;
  for (;;) {
    const m = call.exec(code.slice(i));
    if (!m) return calls;
    const open = i + m[0].length - 1;
    const close = closing(code, open);
    if (close < 0) return calls;
    calls.push({ method: m[1], args: splitTopLevel(code.slice(open + 1, close)).map((a) => a.trim()) });
    i = close + 1;
  }
}

/** Tools declared in one tool class with `ToolDef.builder("name", Args.class).title(...)...hints(...)`. */
function parseToolClass(file, src) {
  const code = stripComments(src);
  const tools = [];
  const problems = [];
  const builder = /\bToolDef\s*\.\s*builder\s*\(/g;
  for (let m; (m = builder.exec(code));) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    const [nameExpr = ''] = close < 0 ? [] : splitTopLevel(code.slice(open + 1, close));
    const name = stringExpr(nameExpr);
    if (name === null) {
      problems.push(`${file}: a ToolDef.builder name is not a string literal: ${nameExpr.trim() || '(unreadable)'}`);
      continue;
    }
    const calls = chainedCalls(code, close + 1);
    const where = `${file}: ${name}`;
    const of = (method) => calls.filter((c) => c.method === method);

    let title = null;
    const titles = of('title');
    if (titles.length !== 1) problems.push(`${where}: expected one .title(...), found ${titles.length}`);
    else if ((title = stringExpr(titles[0].args.join(','))) === null) problems.push(`${where}: .title(...) is not a string literal`);

    let hints = null;
    const hintCalls = of('hints');
    if (hintCalls.length !== 1) problems.push(`${where}: expected one .hints(...), found ${hintCalls.length}`);
    else if (hintCalls[0].args.length !== 4 || !hintCalls[0].args.every((a) => a === 'true' || a === 'false')) {
      problems.push(`${where}: .hints(...) must be four boolean literals, found (${hintCalls[0].args.join(', ')})`);
    } else {
      hints = Object.fromEntries(HINTS.map((h, i) => [h, hintCalls[0].args[i] === 'true']));
    }

    const args = new Set();
    const required = new Set();
    for (const c of calls) {
      if (!['arg', 'describe', 'required', 'requiredIn'].includes(c.method)) continue;
      const literals = c.args.map(stringExpr);
      if (c.method === 'arg' || c.method === 'describe') {
        if (literals[0] === null) problems.push(`${where}: .${c.method}(...) names an argument with a non-literal: ${c.args[0]}`);
        else if (c.method === 'arg' || !/[.[]/.test(literals[0])) args.add(literals[0]);
        continue;
      }
      const names = c.method === 'required' ? literals : literals[0] === '' ? literals.slice(1) : [];
      if (literals[0] === null && c.method === 'requiredIn') problems.push(`${where}: .requiredIn(...) path is not a literal`);
      else if (names.includes(null)) problems.push(`${where}: .${c.method}(...) has a non-literal argument name`);
      else names.forEach((n) => required.add(n));
    }
    required.forEach((n) => args.add(n));

    if (title !== null && hints !== null) {
      tools.push({ name, title, hints, args: [...args].sort(), required: [...required].sort() });
    }
  }
  return { tools, problems };
}

/** The tool classes registered as `new XTools(...).tools()`, in listing order. */
function registeredClasses(code) {
  const out = [];
  const re = /\bnew\s+(\w+Tools)\s*\(/g;
  for (let m; (m = re.exec(code));) {
    const close = closing(code, m.index + m[0].length - 1);
    if (close >= 0 && /^\s*\.\s*tools\s*\(\s*\)/.test(code.slice(close + 1))) out.push(m[1]);
  }
  return out;
}

/** Prompt names: `new McpSchema.Prompt("literal", ...)` or `"prefix" + domain` inside a loop over DOMAINS. */
function promptNames(code, domains, problems) {
  const out = [];
  const re = /\bnew\s+(?:McpSchema\s*\.\s*)?Prompt\s*\(/g;
  for (let m; (m = re.exec(code));) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    const first = close < 0 ? '' : splitTopLevel(code.slice(open + 1, close))[0].trim();
    const literal = stringExpr(first);
    const prefixed = /^("(?:[^"\\\n]|\\.)*")\s*\+\s*(\w+)$/.exec(first);
    const loop = prefixed && new RegExp(`for\\s*\\(\\s*(?:final\\s+)?(?:String|var)\\s+${prefixed[2]}\\s*:\\s*(?:\\w+\\s*\\.\\s*)?DOMAINS\\s*\\)`);
    if (literal !== null) out.push(literal);
    else if (loop && loop.test(code.slice(0, m.index))) out.push(...domains.map((d) => unescapeJava(prefixed[1].slice(1, -1)) + d));
    else problems.push(`McpFeaturesConfiguration.java: a prompt name is neither a literal nor "prefix" + a checklist domain: ${first}`);
  }
  if (out.length === 0 && problems.length === 0) problems.push('McpFeaturesConfiguration.java: no prompts found (new McpSchema.Prompt(...))');
  return out;
}

/** The constant names of `enum <name> { A, B(1), ...; }`. */
function enumConstants(file, code, name, problems) {
  const m = new RegExp(`\\benum\\s+${name}\\b[^{]*\\{`).exec(code);
  if (!m) {
    problems.push(`${file}: enum ${name} not found`);
    return [];
  }
  const open = m.index + m[0].length - 1;
  const { parts } = splitTopLevel(code.slice(open + 1, closing(code, open)), ',', ';');
  const names = [];
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    const c = /^(?:@\w+(?:\([^)]*\))?\s+)*([A-Z][A-Z0-9_]*)\s*(?:\(|\{|$)/.exec(part);
    if (c) names.push(c[1]);
    else problems.push(`${file}: enum ${name} has a constant that does not read as one: ${part.slice(0, 60)}`);
  }
  if (names.length === 0) problems.push(`${file}: enum ${name} has no constants`);
  return names.sort();
}

/** The values of `String ERROR_X = "..."` constants; any initializer other than string literals is a problem. */
function failureCodes(code, problems) {
  const declarations = [...code.matchAll(/\bString\s+(ERROR_\w+)\s*=/g)];
  const out = [];
  for (const m of declarations) {
    const { parts, stopped } = splitTopLevel(code.slice(m.index + m[0].length), ',', ';');
    const value = stopped ? stringExpr(parts[0].trim()) : null;
    if (value === null) problems.push(`RunRecord.java: ${m[1]} is not initialized with string literals: ${parts[0].trim().slice(0, 60)}`);
    else out.push(value);
  }
  if (declarations.length === 0) problems.push('RunRecord.java: no ERROR_* failure code constants found');
  return [...new Set(out)].sort();
}

function stringList(file, code, field, problems) {
  const m = new RegExp(`\\b${field}\\s*=\\s*List\\s*\\.\\s*of\\s*\\(`).exec(code);
  const close = m ? closing(code, m.index + m[0].length - 1) : -1;
  if (close < 0) {
    problems.push(`${file}: ${field} = List.of(...) not found`);
    return [];
  }
  const items = splitTopLevel(code.slice(m.index + m[0].length, close)).map((s) => s.trim()).filter(Boolean);
  const values = items.map(stringExpr);
  if (values.includes(null)) problems.push(`${file}: ${field} holds a value that is not a string literal`);
  return values.filter((v) => v !== null);
}

function assertedToolCount(code, problems) {
  const counts = new Set([...code.matchAll(/Tool::name\s*\)\s*\.\s*hasSize\s*\(\s*(\d+)\s*\)/g)].map((m) => Number(m[1])));
  if (counts.size !== 1) {
    problems.push(`McpProtocolTest.java: expected one asserted tool count (...Tool::name).hasSize(n)), found ${counts.size}`);
    return null;
  }
  return [...counts][0];
}

/** The text of the `instructions:` key: the block scalar's lines, dedented, or the inline value. */
function instructionsText(yml) {
  const lines = yml.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*instructions:/.test(l));
  if (at < 0) return null;
  const indent = /^\s*/.exec(lines[at])[0].length;
  const inline = lines[at].replace(/^\s*instructions:\s*/, '');
  if (inline && !/^[>|]/.test(inline)) return inline.trim();
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() !== '' && /^\s*/.exec(l)[0].length <= indent) break;
    body.push(l.trim() === '' ? '' : l);
  }
  while (body.length && body.at(-1) === '') body.pop();
  const margin = Math.min(...body.filter(Boolean).map((l) => /^\s*/.exec(l)[0].length));
  return body.map((l) => l.slice(margin)).join('\n');
}

const sha256 = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

/** The normalized surface; throws ParseError when the source does not read as expected. */
export function snapshot(reader) {
  const problems = [];
  const read = (path) => {
    const text = reader.read(path);
    if (text == null) problems.push(`missing file: ${path}`);
    return text == null ? null : stripComments(text);
  };

  const settings = read(PATHS.settingsTools);
  const domains = settings == null ? [] : stringList('SettingsTools.java', settings, 'DOMAINS', problems);

  const features = read(PATHS.features);
  const registered = features == null ? [] : registeredClasses(features);
  if (features != null && registered.length === 0) {
    problems.push('McpFeaturesConfiguration.java: no registered tool classes found (new XTools(...).tools())');
  }
  const prompts = features == null ? [] : promptNames(features, domains, problems);

  const tools = [];
  for (const cls of registered) {
    const src = reader.read(`${PATHS.toolsDir}/${cls}.java`);
    if (src == null) {
      problems.push(`missing file: ${PATHS.toolsDir}/${cls}.java (registered tool class ${cls})`);
      continue;
    }
    const parsed = parseToolClass(`${cls}.java`, src);
    problems.push(...parsed.problems);
    if (parsed.tools.length === 0) problems.push(`${cls} is registered but ${cls}.java yields no tool builders (ToolDef.builder("name", ...))`);
    tools.push(...parsed.tools);
  }
  const files = reader.list(PATHS.toolsDir);
  if (files == null) problems.push(`missing directory: ${PATHS.toolsDir}`);
  for (const file of (files ?? []).filter((f) => /Tools\.java$/.test(f))) {
    const cls = file.replace(/\.java$/, '');
    if (registered.includes(cls)) continue;
    if (/\bToolDef\b/.test(stripComments(reader.read(`${PATHS.toolsDir}/${file}`) ?? ''))) {
      problems.push(`${file} defines tools but ${cls} is not registered in McpFeaturesConfiguration.java`);
    }
  }
  if (registered.length > 0 && tools.length === 0) {
    problems.push('no tool builders matched in any registered tool class; the builder pattern may have changed');
  }
  const seen = new Set();
  for (const t of tools) {
    if (seen.has(t.name)) problems.push(`tool ${t.name} is declared more than once`);
    seen.add(t.name);
  }
  const protocol = read(PATHS.protocolTest);
  const asserted = protocol == null ? null : assertedToolCount(protocol, problems);
  if (asserted !== null && asserted !== tools.length) {
    problems.push(`parsed ${tools.length} tools but McpProtocolTest.java asserts ${asserted}`);
  }

  const errorCode = read(PATHS.errorCode);
  const runStatus = read(PATHS.runStatus);
  const proposalStatus = read(PATHS.proposalStatus);
  const runOps = read(PATHS.runOps);
  const runRecord = read(PATHS.runRecord);
  const statuses = {
    runStatuses: runStatus == null ? [] : enumConstants('RunStatus.java', runStatus, 'RunStatus', problems),
    proposalStatuses: proposalStatus == null ? [] : enumConstants('ProposalStatus.java', proposalStatus, 'ProposalStatus', problems),
    compileProfileStates: runOps == null ? [] : enumConstants('RunOps.java', runOps, 'ProfileState', problems),
    runFailureCodes: runRecord == null ? [] : failureCodes(runRecord, problems),
  };
  const errorCodes = errorCode == null ? [] : enumConstants('ErrorCode.java', errorCode, 'ErrorCode', problems);

  const checklists = {};
  const checklistFiles = reader.list(PATHS.checklistsDir);
  if (checklistFiles == null) problems.push(`missing directory: ${PATHS.checklistsDir}`);
  for (const file of (checklistFiles ?? []).filter((f) => f.endsWith('.md'))) {
    const text = reader.read(`${PATHS.checklistsDir}/${file}`);
    if (text == null) problems.push(`missing file: ${PATHS.checklistsDir}/${file}`);
    else checklists[file] = sha256(text);
  }
  const yml = reader.read(PATHS.applicationYml);
  if (yml == null) problems.push(`missing file: ${PATHS.applicationYml}`);
  const instructions = yml == null ? null : instructionsText(yml);
  if (yml != null && !instructions) problems.push('application.yml: no instructions: text found');

  if (problems.length) throw new ParseError(problems);
  return {
    source: { repo: reader.repo, commit: reader.commit },
    tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    prompts: [...new Set(prompts)].sort(),
    errorCodes,
    statuses,
    checklistDomains: [...domains].sort(),
    contentHashes: { checklists, serverInstructions: sha256(instructions) },
  };
}

// ---- comparison and report ----

const code = (s) => `\`${s}\``;
const added = (a, b) => b.filter((x) => !a.includes(x));

/** Changes from `base` to `cur`, ignoring the source commit. Each names what a skill would mention. */
export function diff(base, cur) {
  const changes = [];
  const add = (section, text, mentions, extra = {}) => changes.push({ section, text, mentions, ...extra });

  const baseTools = new Map(base.tools.map((t) => [t.name, t]));
  const curTools = new Map(cur.tools.map((t) => [t.name, t]));
  for (const [name, t] of curTools) {
    if (baseTools.has(name)) continue;
    const hints = HINTS.map((h) => `${h} ${t.hints[h]}`).join(', ');
    const required = t.required.length ? `; required ${t.required.map(code).join(', ')}` : '';
    add('Tools', `Added ${code(name)} ("${t.title}"; ${hints}; arguments ${t.args.map(code).join(', ') || 'none'}${required}).`, [name], { newTool: true });
  }
  for (const name of baseTools.keys()) if (!curTools.has(name)) add('Tools', `Removed ${code(name)}.`, [name]);
  for (const [name, was] of baseTools) {
    const now = curTools.get(name);
    if (!now) continue;
    if (was.title !== now.title) add('Tools', `${code(name)}: title "${was.title}" → "${now.title}".`, [name]);
    for (const h of HINTS) {
      if (was.hints[h] !== now.hints[h]) add('Tools', `${code(name)}: ${h} hint ${was.hints[h]} → ${now.hints[h]}.`, [name]);
    }
    for (const a of added(was.args, now.args)) add('Tools', `${code(name)}: argument ${code(a)} added.`, [name]);
    for (const a of added(now.args, was.args)) add('Tools', `${code(name)}: argument ${code(a)} removed.`, [name]);
    for (const a of added(was.required, now.required)) add('Tools', `${code(name)}: ${code(a)} now required.`, [name]);
    for (const a of added(now.required, was.required)) add('Tools', `${code(name)}: ${code(a)} no longer required.`, [name]);
  }

  const lists = [
    ['Prompts', 'prompt', base.prompts, cur.prompts],
    ['Error codes', 'error code', base.errorCodes, cur.errorCodes],
    ['Checklist domains', 'checklist domain', base.checklistDomains, cur.checklistDomains],
  ];
  for (const [section, noun, was, now] of lists) {
    for (const x of added(was, now)) add(section, `Added ${noun} ${code(x)}.`, [x]);
    for (const x of added(now, was)) add(section, `Removed ${noun} ${code(x)}.`, [x]);
  }

  for (const [key, label] of Object.entries(STATUS_SETS)) {
    const was = base.statuses[key];
    const now = cur.statuses[key];
    const set = { label, values: [...new Set([...was, ...now])] };
    const Label = label[0].toUpperCase() + label.slice(1);
    for (const x of added(was, now)) add('Statuses', `${Label}: added ${code(x)}.`, [x], { set });
    for (const x of added(now, was)) add('Statuses', `${Label}: removed ${code(x)}.`, [x], { set });
  }

  const wasLists = base.contentHashes.checklists;
  const nowLists = cur.contentHashes.checklists;
  for (const file of new Set([...Object.keys(wasLists), ...Object.keys(nowLists)])) {
    const domain = file.replace(/\.md$/, '');
    if (!(file in wasLists)) add('Content', `Checklist ${code(file)} added.`, [domain]);
    else if (!(file in nowLists)) add('Content', `Checklist ${code(file)} removed.`, [domain]);
    else if (wasLists[file] !== nowLists[file]) add('Content', `Checklist ${code(file)} changed.`, [domain]);
  }
  if (base.contentHashes.serverInstructions !== cur.contentHashes.serverInstructions) {
    add('Content', 'Server instructions changed; check the skills still agree with them.', []);
  }
  return changes;
}

/** `[{ name, text }]` for each skills/<name>/SKILL.md. */
export function loadSkills(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => ({ name: d.name, text: readFileSync(join(dir, d.name, 'SKILL.md'), 'utf8') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mentioning(skills, names) {
  const res = names.map((n) => new RegExp(`(?<![A-Za-z0-9_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`));
  return skills.filter((s) => res.some((re) => re.test(s.text))).map((s) => s.name);
}

export function report(base, cur, changes, skills) {
  const out = [
    '# Route Optimization service drift',
    '',
    `${cur.source.repo} at ${code(cur.source.commit)} compared with the baseline taken at ${code(base.source.commit)}.`,
  ];
  const touched = new Map();
  const touch = (skill, name) => touched.set(skill, new Set([...(touched.get(skill) ?? []), name]));
  for (const section of ['Tools', 'Prompts', 'Error codes', 'Statuses', 'Checklist domains', 'Content']) {
    const inSection = changes.filter((c) => c.section === section);
    if (inSection.length === 0) continue;
    out.push('', `## ${section}`, '');
    for (const c of inSection) {
      let line = `- ${c.text}`;
      const hits = mentioning(skills, c.mentions);
      for (const s of hits) c.mentions.forEach((n) => touch(s, n));
      if (c.newTool) line += hits.length ? ` Mentioned by: ${hits.join(', ')}.` : ' No skill mentions this tool yet.';
      else if (hits.length) line += ` Mentioned by: ${hits.join(', ')}.`;
      else if (c.mentions.length) line += ' No skill mentions it.';
      if (c.set) {
        const users = mentioning(skills, c.set.values);
        for (const s of users) touch(s, c.set.label);
        line += ` Skills that use ${c.set.label}: ${users.join(', ') || 'none'}.`;
      }
      out.push(line);
    }
  }
  out.push('', '## Skills to review', '');
  if (touched.size === 0) out.push('- None of the changes is mentioned by a skill.');
  for (const [skill, names] of [...touched].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`- ${skill}: ${[...names].map((n) => (n.includes(' ') ? n : code(n))).join(', ')}`);
  }
  return `${out.join('\n')}\n`;
}

// ---- command line ----

const USAGE = 'usage: snapshot.mjs [--write] [--source-dir <dir> [--commit <sha>]] [--baseline <file>] [--skills-dir <dir>]';

/** Runs the check; returns { code, out, err } instead of exiting. `reader` replaces the GitHub reader. */
export function main(argv, { reader } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        write: { type: 'boolean', default: false },
        'source-dir': { type: 'string' },
        commit: { type: 'string' },
        baseline: { type: 'string' },
        'skills-dir': { type: 'string' },
      },
    }));
  } catch (e) {
    return { code: 2, out: '', err: `${e.message}\n${USAGE}\n` };
  }
  const baselinePath = resolve(values.baseline ?? DEFAULT_BASELINE);
  try {
    const source = reader ?? (values['source-dir'] ? dirReader(resolve(values['source-dir']), values.commit) : ghReader());
    const surface = snapshot(source);
    if (values.write) {
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(surface, null, 2)}\n`);
      const rel = relative(process.cwd(), baselinePath);
      const where = rel && !rel.startsWith('..') ? rel : baselinePath;
      return {
        code: 0,
        out: `Wrote ${where}: ${surface.tools.length} tools, ${surface.prompts.length} prompts, ${surface.errorCodes.length} error codes from ${surface.source.repo} at ${surface.source.commit}.\n`,
        err: '',
      };
    }
    if (!existsSync(baselinePath)) return { code: 2, out: '', err: `No baseline at ${baselinePath}. Run with --write to create it.\n` };
    const base = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const changes = diff(base, surface);
    if (changes.length === 0) {
      return {
        code: 0,
        out: `No drift: ${surface.source.repo} at ${code(surface.source.commit)} matches the baseline taken at ${code(base.source.commit)}.\n`,
        err: '',
      };
    }
    return { code: 1, out: report(base, surface, changes, loadSkills(resolve(values['skills-dir'] ?? DEFAULT_SKILLS))), err: '' };
  } catch (e) {
    if (e instanceof ParseError) {
      return {
        code: 2,
        out: '',
        err: `Parse failure: the service source no longer reads as expected, so nothing was compared.\n${e.problems.map((p) => `- ${p}`).join('\n')}\n`,
      };
    }
    return { code: 2, out: '', err: `Drift check failed: ${e.message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = main(process.argv.slice(2));
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
