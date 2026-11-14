import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PATHS, dirReader, main, prodCommit, snapshot } from '../scripts/drift/snapshot.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'tests/fixtures/drift');
const SOURCE = join(FIXTURES, 'source');
const SKILLS = join(FIXTURES, 'skills');
const BASELINE = join(FIXTURES, 'expected-surface.json');
const SCRIPT = join(ROOT, 'scripts/drift/snapshot.mjs');

const tool = (name) => `${PATHS.toolsDir}/${name}.java`;

/** Replaces `from` with `to`, failing if `from` is absent so an edit never silently does nothing. */
function rep(from, to) {
  return (text) => {
    assert.ok(text.includes(from), `fixture edit target not found: ${from}`);
    return text.split(from).join(to);
  };
}

/** The fixture source with edits: a function rewrites a file, a string adds or replaces one, null deletes one. */
function fixture(edits = {}, commit = 'fixture-base') {
  const base = dirReader(SOURCE, commit);
  return {
    repo: base.repo,
    commit,
    list(dir) {
      const names = new Set(base.list(dir) ?? []);
      for (const [path, edit] of Object.entries(edits)) {
        if (dirname(path) !== dir) continue;
        if (edit === null) names.delete(basename(path));
        else names.add(basename(path));
      }
      return [...names].sort();
    },
    read(path) {
      if (!(path in edits)) return base.read(path);
      const edit = edits[path];
      if (edit === null) return null;
      return typeof edit === 'function' ? edit(base.read(path)) : edit;
    },
  };
}

function compare(edits, commit) {
  return main(['--baseline', BASELINE, '--skills-dir', SKILLS], { reader: fixture(edits, commit) });
}

/** The single report line that contains every needle. */
function line(out, ...needles) {
  const hits = out.split('\n').filter((l) => needles.every((n) => l.includes(n)));
  assert.equal(hits.length, 1, `expected one line with ${needles.join(' + ')}, got ${hits.length}:\n${out}`);
  return hits[0];
}

test('parses the synthetic source into the expected normalized surface', () => {
  assert.deepEqual(snapshot(fixture()), JSON.parse(readFileSync(BASELINE, 'utf8')));
});

test('identical source reports no drift and exits 0', () => {
  const r = compare({});
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No drift/);
});

test('a change of source commit alone is not drift', () => {
  const r = compare({}, 'f00dfeed');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No drift/);
});

test('an added tool and a renamed checklist prompt land in one report with the skills they touch', () => {
  const r = compare({
    [tool('GadgetTools')]: (t) => rep('List.of(countGadgets(), mapGadgets())', 'List.of(countGadgets(), mapGadgets(), sortGadgets())')(t)
      .replace(/}\s*$/, `
    ToolDef sortGadgets() {
        return ToolDef.builder("sort_gadgets", SortRequest.class)
                .title("Sort gadgets")
                .description("Sorts.")
                .arg("bin_id", "The bin.")
                .required("bin_id")
                .output(Sorted.class)
                .hints(false, false, true, false)
                .handler((caller, req) -> null)
                .build();
    }
}
`),
    [PATHS.protocolTest]: rep('hasSize(4)', 'hasSize(5)'),
    [PATHS.settingsTools]: rep('"alpha-care", "beta-fuel"', '"alpha-home", "beta-fuel"'),
  });
  assert.equal(r.code, 1, r.err);
  assert.match(line(r.out, 'Added', '`sort_gadgets`'), /No skill mentions this tool yet/);
  assert.match(line(r.out, 'Removed', '`domain-checklist-alpha-care`'), /lm-onboard/);
  line(r.out, 'Added', '`domain-checklist-alpha-home`');
  assert.match(line(r.out, 'Removed', '`alpha-care`', 'domain'), /lm-onboard/);
});

test("flipping deliver_run's destructive hint shows the change and the skill that mentions it", () => {
  const r = compare({ [tool('DeliveryTools')]: rep('.hints(false, true, false, true)', '.hints(false, false, false, true)') });
  assert.equal(r.code, 1, r.err);
  const l = line(r.out, '`deliver_run`', 'destructive');
  assert.match(l, /true → false/);
  assert.match(l, /lm-optimization/);
  assert.doesNotMatch(l, /lm-quiet/);
});

test('title, argument and required changes are each reported', () => {
  const r = compare({
    [tool('GadgetTools')]: (t) => rep('.title("Count gadgets")', '.title("Count the gadgets")')(
      rep('.arg("limit", "At most (default " + 20 + ").")', '.arg("max", "At most.")')(
        rep('.required("bin_id", "kind")', '.required("bin_id")')(t))),
  });
  assert.equal(r.code, 1, r.err);
  line(r.out, '`count_gadgets`', 'title', 'Count the gadgets');
  line(r.out, '`count_gadgets`', 'argument', '`max`', 'added');
  line(r.out, '`count_gadgets`', 'argument', '`limit`', 'removed');
  line(r.out, '`count_gadgets`', 'required', '`kind`');
});

test('removing an error code a skill routes on names that skill', () => {
  const r = compare({ [PATHS.errorCode]: rep('    GADGET_NOT_FOUND(404),\n', '') });
  assert.equal(r.code, 1, r.err);
  assert.match(line(r.out, 'Removed', '`GADGET_NOT_FOUND`'), /lm-onboard/);
});

test('a new proposal status is shown with the skill that uses proposal statuses', () => {
  const r = compare({ [PATHS.proposalStatus]: rep('    SUPERSEDED\n', '    SUPERSEDED,\n    WITHDRAWN\n') });
  assert.equal(r.code, 1, r.err);
  const l = line(r.out, '`WITHDRAWN`');
  assert.match(l, /[Pp]roposal status/);
  assert.match(l, /lm-rule/);
});

test('changed checklist and server instructions are reported by hash', () => {
  const r = compare({
    [`${PATHS.checklistsDir}/beta-fuel.md`]: (t) => `${t}2. A new question?\n`,
    [PATHS.applicationYml]: rep('then count_gadgets.', 'then map_gadgets.'),
  });
  assert.equal(r.code, 1, r.err);
  line(r.out, '`beta-fuel.md`', 'changed');
  line(r.out, 'instructions', 'changed');
});

function assertParseFailure(edits, pattern) {
  const r = compare(edits);
  assert.equal(r.code, 2, `expected a parse failure, got exit ${r.code}\n${r.out}`);
  assert.doesNotMatch(r.out, /No drift/);
  assert.match(r.err, pattern);
}

const allToolFiles = (edit) => Object.fromEntries(['SettingsTools', 'GadgetTools', 'DeliveryTools'].map((c) => [tool(c), edit]));

test('a builder pattern that matches no tools is a parse failure, not "no drift"', () => {
  assertParseFailure(allToolFiles((t) => t.split('ToolDef.builder(').join('ToolDef.define(')), /no tool builders/i);
});

test('a registered class that yields no builders is a parse failure', () => {
  assertParseFailure({ [tool('GadgetTools')]: (t) => t.split('ToolDef.builder(').join('ToolDef.define(') }, /GadgetTools.*no tool builders/);
});

test('a parsed total that differs from the asserted tool count is a parse failure', () => {
  assertParseFailure({ [PATHS.protocolTest]: rep('hasSize(4)', 'hasSize(5)') }, /4 tools.*asserts 5/);
});

test('a tool class that is not registered is a parse failure', () => {
  assertParseFailure({
    [tool('ExtraTools')]: 'class ExtraTools { List<ToolDef> tools() { return List.of(ToolDef.builder("extra", A.class)'
      + '.title("Extra").hints(true, false, true, false).build()); } }',
  }, /ExtraTools.*not registered/);
});

test('a missing source file is a parse failure', () => {
  assertParseFailure({ [PATHS.runStatus]: null }, /missing file.*RunStatus\.java/);
});

test('hints or names that are not literals are parse failures', () => {
  assertParseFailure({ [tool('DeliveryTools')]: rep('.hints(false, true, false, true)', '.hints(false, DESTRUCTIVE, false, true)') }, /deliver_run.*hints/);
  assertParseFailure({ [tool('DeliveryTools')]: rep('ToolDef.builder("deliver_run"', 'ToolDef.builder(DELIVER') }, /DeliveryTools.*not a string literal/);
});

test('a failure code built from concatenated literals is read, not dropped', () => {
  const r = compare({
    [PATHS.runRecord]: rep('    public static final String OTHER', '    public static final String ERROR_TIMEOUT = "TIMED" + "_OUT";\n    public static final String OTHER'),
  });
  assert.equal(r.code, 1, r.err);
  assert.match(line(r.out, '`TIMED_OUT`'), /[Rr]un failure codes: added/);
});

test('a failure code whose initializer is not string literals is a parse failure', () => {
  assertParseFailure({
    [PATHS.runRecord]: rep('    public static final String OTHER', '    public static final String ERROR_TIMEOUT = PREFIX + "TIMEOUT";\n    public static final String OTHER'),
  }, /ERROR_TIMEOUT.*not initialized with string literals/);
});

/** A stand-in for `gh api` over deployments `[{ id, sha, created_at, state, job }]`; job null means no readable job. */
function deploymentsApi(deployments) {
  const repo = 'example/service';
  const routes = new Map([[`repos/${repo}/deployments?environment=prod&per_page=100`, deployments.map(({ id, sha, created_at }) => ({ id, sha, created_at }))]]);
  for (const d of deployments) {
    const jobId = d.id * 10;
    routes.set(`repos/${repo}/deployments/${d.id}/statuses?per_page=1`, [{ state: d.state, log_url: `/${repo}/actions/runs/${d.id}/job/${jobId}` }]);
    if (d.job !== null) routes.set(`repos/${repo}/actions/jobs/${jobId}`, { id: jobId, name: d.job });
  }
  const calls = [];
  const api = (args) => {
    calls.push(args.at(-1));
    return routes.has(args.at(-1)) ? JSON.stringify(routes.get(args.at(-1))) : null;
  };
  return { repo, api, calls };
}

const MCP_JOB = 'Deploy / Apply mcp (prod)';
const OTHER_JOB = 'Deploy / Apply lambda (prod)';

test('the prod commit skips a newer successful deployment of another app and a failed MCP one', () => {
  const { repo, api } = deploymentsApi([
    { id: 1, sha: 'aaa111', created_at: '2026-01-01T00:00:00Z', state: 'success', job: MCP_JOB },
    { id: 2, sha: 'bbb222', created_at: '2026-01-03T00:00:00Z', state: 'failure', job: MCP_JOB },
    { id: 3, sha: 'bbb222', created_at: '2026-01-02T00:00:00Z', state: 'success', job: OTHER_JOB },
  ]);
  assert.equal(prodCommit(repo, api), 'aaa111');
});

test('the prod commit is the newest successful MCP deployment', () => {
  const { repo, api, calls } = deploymentsApi([
    { id: 1, sha: 'aaa111', created_at: '2026-01-01T00:00:00Z', state: 'success', job: MCP_JOB },
    { id: 2, sha: 'ccc333', created_at: '2026-01-04T00:00:00Z', state: 'success', job: MCP_JOB },
  ]);
  assert.equal(prodCommit(repo, api), 'ccc333');
  assert.ok(!calls.some((c) => c.includes('deployments/1/')), 'stops at the first match');
});

test('no successful MCP deployment, or one whose job cannot be read, is an error rather than a guess', () => {
  const none = deploymentsApi([{ id: 1, sha: 'aaa111', created_at: '2026-01-01T00:00:00Z', state: 'success', job: OTHER_JOB }]);
  assert.throws(() => prodCommit(none.repo, none.api), /no successful MCP server deployment/);
  const unreadable = deploymentsApi([
    { id: 1, sha: 'aaa111', created_at: '2026-01-01T00:00:00Z', state: 'success', job: MCP_JOB },
    { id: 2, sha: 'bbb222', created_at: '2026-01-02T00:00:00Z', state: 'success', job: null },
  ]);
  assert.throws(() => prodCommit(unreadable.repo, unreadable.api), /deployment 2 .*not readable/);
});

test('the CLI writes a baseline from a source directory, then reports no drift against it', () => {
  const baseline = join(mkdtempSync(join(tmpdir(), 'drift-')), 'surface.json');
  const args = [SCRIPT, '--source-dir', SOURCE, '--commit', 'fixture-base', '--baseline', baseline, '--skills-dir', SKILLS];
  const write = execFileSync(process.execPath, [...args, '--write'], { encoding: 'utf8' });
  assert.match(write, /4 tools/);
  assert.deepEqual(JSON.parse(readFileSync(baseline, 'utf8')), JSON.parse(readFileSync(BASELINE, 'utf8')));
  const again = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /No drift/);
});

test('nothing in scripts/drift addresses a network host', () => {
  const dir = join(ROOT, 'scripts/drift');
  for (const name of readdirSync(dir)) {
    const text = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(text, /https?:\/\/|thinkwork\.ai|amazonaws\.com/, name);
  }
});
