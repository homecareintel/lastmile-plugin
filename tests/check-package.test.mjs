import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPackage } from "../scripts/check-package.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-package.mjs", import.meta.url));

// Every secret, non-public host and notice below is assembled at run time, so
// this file holds no literal the package check would flag when it scans the repo.
const join = (...parts) => parts.join("");

const PROD_URL = "https://mcp.routing.thinkwork.ai/mcp";
const SKILLS = ["lm-setup", "lm-doctor", "lm-onboard", "lm-rule", "lm-optimization", "lm-explain"];
const DEV_HOST = join("mcp-dev", ".lastmile-tei.com");

const json = (value) => `${JSON.stringify(value, null, "\t")}\n`;

// A clean tree in the target layout. The marketplace pin stays on the old
// dev release while both plugin.json files carry the next version and no
// client id ships.
function cleanTree() {
	const files = {
		".mcp.json": {
			mcpServers: {
				"route-optimization": {
					type: "http",
					url: PROD_URL,
					oauth: { callbackPort: 31873, scopes: "openid https://mcp.routing.thinkwork.ai/mcp/tools" },
				},
			},
		},
		".claude-plugin/plugin.json": {
			name: "lastmile",
			version: "0.2.0",
			homepage: "https://github.com/homecareintel/lastmile-plugin",
		},
		".codex-plugin/plugin.json": {
			name: "lastmile",
			version: "0.2.0",
			skills: "./skills/",
			mcpServers: "./.mcp.json",
		},
		".claude-plugin/marketplace.json": {
			name: "lastmile-plugin",
			metadata: { version: "0.1.3-dev" },
			plugins: [
				{
					name: "lastmile",
					source: {
						source: "url",
						url: "https://github.com/homecareintel/lastmile-plugin.git",
						ref: "v0.1.3-dev",
					},
				},
			],
		},
		"README.md": [
			"# lastmile",
			"Install: https://code.claude.com/docs/en/plugins and https://developers.openai.com/codex/plugins.",
			"Sign-in returns to http://localhost:31873/callback or http://127.0.0.1:31873/callback.",
			"Issuer cognito-idp.us-east-1.amazonaws.com, login at routeopt-prod.auth.us-east-1.amazoncognito.com.",
			"Each skill lives in SKILL.md; the manifest is plugin.json; local settings go in settings.local.json.",
			"",
		].join("\n"),
	};
	for (const name of SKILLS) {
		files[`skills/${name}/SKILL.md`] = `---\nname: ${name}\ndescription: Use when the operator asks for ${name}.\n---\n\n# ${name}\n`;
	}
	return files;
}

function writeTree(files) {
	const root = mkdtempSync(path.join(tmpdir(), "check-package-"));
	for (const [rel, content] of Object.entries(files)) {
		const full = path.join(root, rel);
		mkdirSync(path.dirname(full), { recursive: true });
		writeFileSync(full, typeof content === "string" || Buffer.isBuffer(content) ? content : json(content));
	}
	return root;
}

// Build the clean tree, let `mutate` change it, and return the findings.
function check(mutate = () => {}) {
	const files = cleanTree();
	mutate(files);
	const root = writeTree(files);
	try {
		return checkPackage(root).failures;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function assertFailure(failures, file, rule) {
	assert.ok(
		failures.some((f) => f.file === file && f.rule === rule),
		`expected ${rule} in ${file}; got ${JSON.stringify(failures, null, 2)}`,
	);
}

const skill = (name, body) => `---\nname: ${name}\ndescription: A skill.\n---\n\n${body}\n`;

test("a clean tree in the target layout passes with no findings", () => {
	assert.deepEqual(check(), []);
});

test("the old dev pin with plugin version 0.2.0 and no client id passes", () => {
	const failures = check((files) => {
		assert.equal(files[".claude-plugin/marketplace.json"].plugins[0].source.ref, "v0.1.3-dev");
		assert.equal(files[".mcp.json"].mcpServers["route-optimization"].oauth.clientId, undefined);
	});
	assert.deepEqual(failures, []);
});

test("the CLI prints one pass line and exits 0 on a clean tree", () => {
	const root = writeTree(cleanTree());
	try {
		const run = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
		assert.equal(run.status, 0, run.stdout + run.stderr);
		const lines = run.stdout.trim().split("\n");
		assert.equal(lines.length, 1);
		assert.match(lines[0], /passed/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the CLI reports every failure with file and rule and exits non-zero", () => {
	const files = cleanTree();
	files["skills/lm-rule/SKILL.md"] = skill("lm-rule", `Token ${join("ghp", "_", "x".repeat(36))}`);
	files[".codex-plugin/plugin.json"].version = "0.2.1";
	const root = writeTree(files);
	try {
		const run = spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });
		assert.notEqual(run.status, 0);
		const out = run.stdout + run.stderr;
		assert.match(out, /skills\/lm-rule\/SKILL\.md.*secret/);
		assert.match(out, /\.codex-plugin\/plugin\.json.*plugin-version/);
		assert.doesNotMatch(out, /x{36}/, "the matched secret itself is not printed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a GitHub token in a skill file fails, naming the file", () => {
	const failures = check((files) => {
		files["skills/lm-rule/SKILL.md"] = skill("lm-rule", `Use ${join("ghp", "_", "x".repeat(36))}`);
	});
	assertFailure(failures, "skills/lm-rule/SKILL.md", "secret");
});

test("a clientSecret key in .mcp.json fails", () => {
	const failures = check((files) => {
		files[".mcp.json"].mcpServers["route-optimization"].oauth[join("client", "Secret")] = "x";
	});
	assertFailure(failures, ".mcp.json", "secret");
});

test("credential fields in the .mcp.json server fail as mcp-server, naming the field", () => {
	const cases = [
		[(server) => (server.headers = { Authorization: "x" }), ["headers", "headers.Authorization"]],
		[(server) => (server.oauth.accessToken = "x"), ["oauth.accessToken"]],
		[(server) => (server.oauth.password = "x"), ["oauth.password"]],
		[(server) => (server.oauth.apiKey = "x"), ["oauth.apiKey"]],
		[(server) => (server.oauth.bearer = "x"), ["oauth.bearer"]],
	];
	for (const [mutate, keys] of cases) {
		const failures = check((files) => mutate(files[".mcp.json"].mcpServers["route-optimization"]));
		assert.deepEqual(
			failures.filter((f) => f.file === ".mcp.json").map((f) => f.rule),
			keys.map(() => "mcp-server"),
			`only the credential-field rule should catch ${keys.join(", ")}; got ${JSON.stringify(failures)}`,
		);
		for (const key of keys) {
			assert.ok(
				failures.some((f) => f.rule === "mcp-server" && f.detail.endsWith(`credential field: ${key}`)),
				`no mcp-server failure names ${key}: ${JSON.stringify(failures)}`,
			);
		}
	}
});

test("every secret pattern fails in any tracked file", () => {
	// Keyed by the pattern name each sample must trip, so a dropped pattern fails here even when another still matches.
	const samples = [
		["Mapbox token", join("pk", ".eyJ1IjoiZmFrZSJ9")],
		["secret key", join("sk", "_", "FAKEFAKEFAKE")],
		["API key", join("sk", "-proj-", "F".repeat(24))],
		["API key", join("sk", "-ant-", "F".repeat(24))],
		["restricted key", join("rk", "_live_", "FAKEFAKEFAKE")],
		["Slack token", join("xox", "b-", "1234567890-FAKE")],
		["Google API key", join("AI", "za", "F".repeat(35))],
		["OAuth access token", join("oat", "_", "FAKEFAKEFAKE")],
		["AWS access key", join("AKIA", "FAKEFAKEFAKEFAKE")],
		["JWT", join("eyJ", "a".repeat(20), ".", "b".repeat(20), ".", "c".repeat(10))],
		["GitHub token", join("github", "_pat_", "x".repeat(22))],
		["GitHub token", join("ghr", "_", "x".repeat(36))],
		["private key block", join("-----BEGIN ", "RSA PRIVATE KEY-----")],
		["client secret key", join("CLIENT", "_SECRET", "=abc")],
	];
	for (const [name, sample] of samples) {
		const failures = check((files) => {
			files["scripts/sample.mjs"] = `// ${sample}\n`;
		});
		assert.ok(
			failures.some((f) => f.file === "scripts/sample.mjs" && f.rule === "secret" && f.detail.startsWith(`${name} at`)),
			`${name} was not flagged for ${sample.slice(0, 6)}...: ${JSON.stringify(failures)}`,
		);
	}
});

test("a secret in a UTF-16 or binary tracked file still fails", () => {
	const token = join("ghp", "_", "x".repeat(36));
	const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`token ${token}\n`, "utf16le")]);
	const binary = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]), Buffer.from(token), Buffer.from([0x00, 0x01])]);
	for (const [rel, content] of [["docs/notes.txt", utf16], ["assets/icon.png", binary]]) {
		const failures = check((files) => {
			files[rel] = content;
		});
		assert.ok(
			failures.some((f) => f.file === rel && f.rule === "secret" && f.detail.startsWith("GitHub token at")),
			`${rel} was not flagged: ${JSON.stringify(failures)}`,
		);
	}
});

test("every kind of non-public host fails in any tracked file", () => {
	const samples = [
		join("https://", "abc123", ".execute-api.us-east-1.amazonaws.com/prod"),
		join("my-bucket", ".s3.us-east-1.amazonaws.com"),
		join("https://", "abc", ".lambda-url.us-east-1.on.aws/"),
		join("http://10", ".0.12.7:8080/"),
		join("172.20", ".1.5"),
		join("192.168", ".1.10"),
		join("db", ".internal"),
		join("printer", ".local"),
		join("mcp-staging", ".lastmile-tei.com"),
		join("mcp-dev", ".routing.thinkwork.ai"),
		join("routeopt-dev", ".auth.us-east-1.amazoncognito.com"),
		join("routeopt-staging", ".auth.us-east-1.amazoncognito.com"),
	];
	for (const sample of samples) {
		const failures = check((files) => {
			files["scripts/sample.mjs"] = `// see ${sample} for details.\n`;
		});
		assert.ok(
			failures.some((f) => f.file === "scripts/sample.mjs" && f.rule === "non-public-host"),
			`${sample} was not flagged: ${JSON.stringify(failures)}`,
		);
	}
});

test("a LastMile dev-stage URL fails in a skill as a disallowed host", () => {
	const failures = check((files) => {
		files["skills/lm-setup/SKILL.md"] = skill("lm-setup", `Connect to https://${DEV_HOST}/mcp.`);
	});
	assertFailure(failures, "skills/lm-setup/SKILL.md", "disallowed-host");
});

test("a LastMile dev-stage URL fails in scripts/ and docs/plans/ as a non-public host", () => {
	const failures = check((files) => {
		files["scripts/tool.mjs"] = `const url = "https://${DEV_HOST}/mcp";\n`;
		files["docs/plans/plan.md"] = `The old build used https://${DEV_HOST}/mcp.\n`;
	});
	assertFailure(failures, "scripts/tool.mjs", "non-public-host");
	assertFailure(failures, "docs/plans/plan.md", "non-public-host");
});

test("a public host off the allowlist fails in a skill and in top-level docs", () => {
	const failures = check((files) => {
		files["skills/lm-explain/SKILL.md"] = skill("lm-explain", "See https://example.com/guide.");
		files["docs/guide.md"] = "Read more at docs.example.org.\n";
	});
	assertFailure(failures, "skills/lm-explain/SKILL.md", "disallowed-host");
	assertFailure(failures, "docs/guide.md", "disallowed-host");
});

test("a public host off the allowlist passes in docs/plans/", () => {
	const failures = check((files) => {
		files["docs/plans/plan.md"] = "See https://example.com/guide.\n";
	});
	assert.deepEqual(failures, []);
});

test("a second server in .mcp.json fails", () => {
	const failures = check((files) => {
		files[".mcp.json"].mcpServers.extra = { type: "http", url: PROD_URL };
	});
	assertFailure(failures, ".mcp.json", "mcp-server");
});

test("a server URL other than prod fails", () => {
	const failures = check((files) => {
		files[".mcp.json"].mcpServers["route-optimization"].url = "https://mcp.routing.thinkwork.ai/other";
	});
	assertFailure(failures, ".mcp.json", "mcp-server");
});

test("a marketplace entry with a tag key fails", () => {
	const failures = check((files) => {
		files[".claude-plugin/marketplace.json"].plugins[0].tag = "v0.1.3-dev";
	});
	assertFailure(failures, ".claude-plugin/marketplace.json", "marketplace-pin");
});

test("a github source object in the marketplace fails", () => {
	const failures = check((files) => {
		files[".claude-plugin/marketplace.json"].plugins[0].source = {
			source: "github",
			repo: "homecareintel/lastmile-plugin",
			ref: "v0.1.3-dev",
		};
	});
	assertFailure(failures, ".claude-plugin/marketplace.json", "marketplace-pin");
});

test("a ref other than v plus metadata.version fails", () => {
	const failures = check((files) => {
		files[".claude-plugin/marketplace.json"].plugins[0].source.ref = "v0.1.2";
	});
	assertFailure(failures, ".claude-plugin/marketplace.json", "marketplace-pin");
});

test("a pin on the plugin's own version without oauth.clientId fails as a release without a client id", () => {
	const failures = check((files) => {
		const market = files[".claude-plugin/marketplace.json"];
		market.metadata.version = "0.2.0";
		market.plugins[0].source.ref = "v0.2.0";
	});
	assert.deepEqual(
		failures.map((f) => `${f.file} ${f.rule}`),
		[".mcp.json release-client-id"],
	);
});

test("a pin on the plugin's own version with oauth.clientId passes", () => {
	const failures = check((files) => {
		const market = files[".claude-plugin/marketplace.json"];
		market.metadata.version = "0.2.0";
		market.plugins[0].source.ref = "v0.2.0";
		files[".mcp.json"].mcpServers["route-optimization"].oauth.clientId = "public-client-id";
	});
	assert.deepEqual(failures, []);
});

test("differing versions in the two plugin.json files fail", () => {
	const failures = check((files) => {
		files[".codex-plugin/plugin.json"].version = "0.2.1";
	});
	assertFailure(failures, ".codex-plugin/plugin.json", "plugin-version");
});

test("a -dev suffix in either plugin.json fails", () => {
	for (const file of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
		const failures = check((files) => {
			files[file].version = "0.2.0-dev";
		});
		assertFailure(failures, file, "plugin-version");
	}
});

test("a seventh skill folder fails", () => {
	const failures = check((files) => {
		files["skills/lm-data/SKILL.md"] = skill("lm-data", "Old skill.");
	});
	assertFailure(failures, "skills/lm-data", "skills");
});

test("a missing skill folder fails", () => {
	const failures = check((files) => {
		delete files["skills/lm-explain/SKILL.md"];
	});
	assertFailure(failures, "skills/lm-explain", "skills");
});

test("a frontmatter name that differs from its folder fails", () => {
	const failures = check((files) => {
		files["skills/lm-rule/SKILL.md"] = skill("lm-rules", "Body.");
	});
	assertFailure(failures, "skills/lm-rule/SKILL.md", "skill-frontmatter");
});

test("an argument-hint frontmatter key fails", () => {
	const failures = check((files) => {
		files["skills/lm-rule/SKILL.md"] = "---\nname: lm-rule\ndescription: A skill.\nargument-hint: <rule>\n---\n\nBody.\n";
	});
	assertFailure(failures, "skills/lm-rule/SKILL.md", "skill-frontmatter");
});

test("a .agents/skills directory fails", () => {
	const failures = check((files) => {
		files[".agents/skills/lm-setup/SKILL.md"] = skill("lm-setup", "Copy.");
	});
	assertFailure(failures, ".agents/skills", "agents-skills-tree");
});

test("a generated-file notice anywhere fails", () => {
	const failures = check((files) => {
		files["README.md"] = `<!-- ${join("GENERATED", " FILE")} — do not edit -->\n# lastmile\n`;
		files["tests/helper.mjs"] = `// ${join("GENERATED", " FILE")}\n`;
	});
	assertFailure(failures, "README.md", "generated-notice");
	assertFailure(failures, "tests/helper.mjs", "generated-notice");
});

test("in a git work tree only tracked files are scanned", (t) => {
	if (spawnSync("git", ["--version"]).status !== 0) {
		t.skip("git is not installed");
		return;
	}
	const files = cleanTree();
	files["docs/plans/draft.md"] = `Untracked notes on https://${DEV_HOST}/mcp.\n`;
	files["scripts/tracked.mjs"] = `const url = "https://${DEV_HOST}/mcp";\n`;
	const root = writeTree(files);
	try {
		const git = (...args) => {
			const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
			assert.equal(run.status, 0, run.stderr);
		};
		git("init", "-q");
		const tracked = Object.keys(files).filter((rel) => rel !== "docs/plans/draft.md");
		git("add", "--", ...tracked);
		const { failures } = checkPackage(root);
		assert.deepEqual(
			failures.map((f) => `${f.file} ${f.rule}`),
			["scripts/tracked.mjs non-public-host"],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
