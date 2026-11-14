#!/usr/bin/env node
// Package check: fails when the plugin tree carries a token, key or
// non-public hostname, when an installed or published file names a host off
// the allowlist, or when a structural invariant of the package breaks.
//
// Usage: node scripts/check-package.mjs [root]   (root defaults to the cwd)
//
// At the top of a git work tree it scans the tracked files; anywhere else it
// walks the tree. It reports every failure, never echoes a matched secret,
// and exits non-zero on any failure.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROD_SERVER_URL = "https://mcp.routing.thinkwork.ai/mcp";
const PROD_SERVER_HOST = "mcp.routing.thinkwork.ai";

const SKILLS = ["lm-setup", "lm-doctor", "lm-onboard", "lm-rule", "lm-optimization", "lm-explain"];
const SKILL_FRONTMATTER_KEYS = ["name", "description"];

// Hosts that installed and published files may name.
const ALLOWED_HOSTS = new Set([
	PROD_SERVER_HOST,
	"github.com",
	"cognito-idp.us-east-1.amazonaws.com",
	"routeopt-prod.auth.us-east-1.amazoncognito.com",
	"code.claude.com",
	"developers.openai.com",
	"localhost",
	"127.0.0.1",
]);

// A bare name (no scheme) counts as a host only with one of these endings,
// so file names such as SKILL.md or plugin.json are not mistaken for hosts.
const BARE_HOST_TLDS = new Set(["com", "net", "org", "io", "ai", "dev", "cloud", "aws"]);

const SECRET_PATTERNS = [
	{ name: "Mapbox token", pattern: /pk\.eyJ[\w-]+/ },
	{ name: "secret key", pattern: /\bsk_[A-Za-z0-9]{8,}/ },
	{ name: "OAuth access token", pattern: /\boat_[A-Za-z0-9]{8,}/ },
	{ name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "JWT", pattern: /\beyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]{10,}/ },
	{ name: "GitHub token", pattern: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
	{ name: "private key block", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
	{ name: "client secret key", pattern: /["']?\bclient_?secret["']?\s*[:=]/i },
];

const GENERATED_NOTICE = /GENERATED\s+FILE/;

const HOSTNAME = /(?<![\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9](?![\w-])/gi;
const URL_AUTHORITY = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/?#"'<>()[\]`\\]+)/gi;
const PRIVATE_IP =
	/(?<![\w.])(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(?![\w]|\.\d)/g;

const DEV_OR_STAGING_LABEL = /(?:^|[-.])(?:dev|staging)(?:[-.]|$)/;

// Why a host is not public, or null when it is.
function nonPublicReason(host) {
	const labels = host.split(".");
	if (/\.(?:internal|local)$/.test(host)) return "private DNS name";
	if (host.endsWith(".amazonaws.com") && labels.slice(1).some((l) => l === "execute-api" || l.startsWith("s3"))) {
		return "internal AWS hostname";
	}
	if (host.endsWith(".on.aws") && labels.includes("lambda-url")) return "AWS Lambda URL";
	if (host.endsWith(".lastmile-tei.com") && DEV_OR_STAGING_LABEL.test(host.slice(0, -".lastmile-tei.com".length))) {
		return "LastMile dev or staging host";
	}
	if (host.endsWith(".routing.thinkwork.ai") && host !== PROD_SERVER_HOST) return "Route Optimization non-prod host";
	if (/^routeopt-(?:dev|staging)\.auth\.[a-z0-9-]+\.amazoncognito\.com$/.test(host)) {
		return "Route Optimization non-prod sign-in host";
	}
	return null;
}

// Files people install or read on the published repo; every host they name
// must be on the allowlist.
function isPackageFile(rel) {
	return (
		rel === ".mcp.json" ||
		rel === "README.md" ||
		rel === "CHANGELOG.md" ||
		rel.startsWith("skills/") ||
		rel.startsWith("evals/") ||
		rel.startsWith(".claude-plugin/") ||
		rel.startsWith(".codex-plugin/") ||
		/^docs\/[^/]+\.md$/.test(rel)
	);
}

function listFiles(root) {
	const top = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
	if (top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(root)) {
		const ls = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
		if (ls.status !== 0) throw new Error(`git ls-files failed: ${ls.stderr}`);
		return ls.stdout.split("\0").filter(Boolean);
	}
	const files = [];
	const walk = (rel) => {
		for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (entry.name === ".git" || entry.name === "node_modules" || child === "evals/results") continue;
				walk(child);
			} else if (entry.isFile()) {
				files.push(child);
			}
		}
	};
	walk("");
	return files.sort();
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function scanText(rel, text, fail) {
	for (const { name, pattern } of SECRET_PATTERNS) {
		const match = pattern.exec(text);
		if (match) fail(rel, "secret", `${name} at line ${lineOf(text, match.index)}`);
	}
	const notice = GENERATED_NOTICE.exec(text);
	if (notice) fail(rel, "generated-notice", `generated-file notice at line ${lineOf(text, notice.index)}`);

	const nonPublic = new Map();
	for (const match of text.matchAll(PRIVATE_IP)) {
		if (!nonPublic.has(match[0])) nonPublic.set(match[0], `private IP address at line ${lineOf(text, match.index)}`);
	}
	const bareHosts = new Set();
	for (const match of text.matchAll(HOSTNAME)) {
		const host = match[0].toLowerCase();
		const reason = nonPublicReason(host);
		if (reason && !nonPublic.has(host)) nonPublic.set(host, `${reason} at line ${lineOf(text, match.index)}`);
		if (BARE_HOST_TLDS.has(host.slice(host.lastIndexOf(".") + 1))) bareHosts.add(host);
	}
	for (const [host, detail] of nonPublic) fail(rel, "non-public-host", `${host} (${detail})`);

	if (!isPackageFile(rel)) return;
	const hosts = new Set(bareHosts);
	for (const match of text.matchAll(URL_AUTHORITY)) {
		const host = match[1]
			.replace(/^.*@/, "")
			.replace(/:\d*$/, "")
			.replace(/\.+$/, "")
			.toLowerCase();
		if (host) hosts.add(host);
	}
	for (const host of [...hosts].sort()) {
		if (!ALLOWED_HOSTS.has(host)) fail(rel, "disallowed-host", `${host} is not on the package host allowlist`);
	}
}

function readJson(root, rel, rule, fail) {
	try {
		return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
	} catch (error) {
		fail(rel, rule, existsSync(path.join(root, rel)) ? `invalid JSON: ${error.message}` : "file is missing");
		return null;
	}
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function secretKeys(value, prefix = "") {
	if (!isPlainObject(value)) return [];
	return Object.entries(value).flatMap(([key, child]) => [
		...(/secret|password|token|^authorization$|^headers$/i.test(key) ? [`${prefix}${key}`] : []),
		...secretKeys(child, `${prefix}${key}.`),
	]);
}

function checkStructure(root, fail) {
	// Exactly one server, at the prod URL, with no secret.
	const mcp = readJson(root, ".mcp.json", "mcp-server", fail);
	const servers = isPlainObject(mcp?.mcpServers) ? Object.entries(mcp.mcpServers) : [];
	if (mcp && servers.length !== 1) {
		fail(".mcp.json", "mcp-server", `expected exactly one server, found ${servers.length}`);
	}
	for (const [name, server] of servers) {
		if (server?.url !== PROD_SERVER_URL) {
			fail(".mcp.json", "mcp-server", `server "${name}" must use ${PROD_SERVER_URL}, not ${server?.url}`);
		}
		for (const key of secretKeys(server)) {
			fail(".mcp.json", "mcp-server", `server "${name}" carries a credential field: ${key}`);
		}
	}

	// Equal plain-semver versions in both plugin manifests.
	const versions = [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"].map((rel) => {
		const manifest = readJson(root, rel, "plugin-version", fail);
		if (!manifest) return undefined;
		const { version } = manifest;
		if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
			fail(rel, "plugin-version", `version ${version} must be plain semver with no pre-release suffix`);
		}
		return version;
	});
	if (versions.every((v) => typeof v === "string") && versions[0] !== versions[1]) {
		fail(".codex-plugin/plugin.json", "plugin-version", `version ${versions[1]} differs from .claude-plugin/plugin.json ${versions[0]}`);
	}

	// Installs follow a pinned release: a url source with a ref equal to
	// v + metadata.version, and no tag key.
	const marketRel = ".claude-plugin/marketplace.json";
	const market = readJson(root, marketRel, "marketplace-pin", fail);
	const entry = Array.isArray(market?.plugins) ? market.plugins.find((p) => p?.name === "lastmile") : undefined;
	let ref;
	if (market && !entry) fail(marketRel, "marketplace-pin", 'no "lastmile" plugin entry');
	if (entry) {
		const source = entry.source;
		if (!isPlainObject(source) || source.source !== "url") {
			fail(marketRel, "marketplace-pin", 'the "lastmile" source must be an object with "source": "url"');
		}
		if ("tag" in entry || (isPlainObject(source) && "tag" in source)) {
			fail(marketRel, "marketplace-pin", 'the "lastmile" entry must not carry a "tag" key; pin with "ref"');
		}
		ref = isPlainObject(source) ? source.ref : undefined;
		const expected = `v${market.metadata?.version}`;
		if (typeof ref !== "string" || ref !== expected) {
			fail(marketRel, "marketplace-pin", `ref ${ref} must equal "v" + metadata.version (${expected})`);
		}
	}

	// A release pin (one naming the plugin's own version) needs the public
	// sign-in client id.
	if (typeof ref === "string" && versions.some((v) => typeof v === "string" && ref === `v${v}`)) {
		const clientId = servers[0]?.[1]?.oauth?.clientId;
		if (typeof clientId !== "string" || clientId.trim() === "") {
			fail(".mcp.json", "release-client-id", `the pin ${ref} names the plugin's own version but oauth.clientId is missing`);
		}
	}

	// Exactly the six skill folders, each with portable frontmatter.
	const skillsDir = path.join(root, "skills");
	const folders = existsSync(skillsDir)
		? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
		: [];
	for (const name of folders.filter((f) => !SKILLS.includes(f)).sort()) {
		fail(`skills/${name}`, "skills", `unexpected skill folder; the plugin ships exactly ${SKILLS.join(", ")}`);
	}
	for (const name of SKILLS) {
		if (!folders.includes(name)) {
			fail(`skills/${name}`, "skills", "required skill folder is missing");
			continue;
		}
		checkFrontmatter(root, name, fail);
	}

	if (existsSync(path.join(root, ".agents/skills"))) {
		fail(".agents/skills", "agents-skills-tree", "per-host skill copies are not allowed; skills/ serves every host");
	}
}

function checkFrontmatter(root, name, fail) {
	const rel = `skills/${name}/SKILL.md`;
	let text;
	try {
		text = readFileSync(path.join(root, rel), "utf8");
	} catch {
		fail(rel, "skill-frontmatter", "SKILL.md is missing");
		return;
	}
	const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
	if (!block) {
		fail(rel, "skill-frontmatter", "no frontmatter block");
		return;
	}
	const fields = new Map();
	for (const line of block[1].split(/\r?\n/)) {
		const field = /^([^\s#:][^:]*):(.*)$/.exec(line);
		if (field) fields.set(field[1].trim(), field[2].trim().replace(/^(["'])(.*)\1$/, "$2"));
	}
	for (const key of fields.keys()) {
		if (!SKILL_FRONTMATTER_KEYS.includes(key)) {
			fail(rel, "skill-frontmatter", `key "${key}" is not portable; only name and description are allowed`);
		}
	}
	if (fields.get("name") !== name) {
		fail(rel, "skill-frontmatter", `name "${fields.get("name") ?? ""}" must equal the folder name "${name}"`);
	}
	if (!fields.get("description")) fail(rel, "skill-frontmatter", "description is missing");
}

export function checkPackage(root = process.cwd()) {
	const failures = [];
	const fail = (file, rule, detail) => failures.push({ file, rule, detail });

	checkStructure(root, fail);

	const files = listFiles(root);
	let scanned = 0;
	for (const rel of files) {
		const full = path.join(root, rel);
		if (!existsSync(full) || !statSync(full).isFile()) continue;
		const buffer = readFileSync(full);
		if (buffer.includes(0)) continue; // binary
		scanned += 1;
		scanText(rel, buffer.toString("utf8"), fail);
	}
	return { failures, scanned };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = path.resolve(process.argv[2] ?? process.cwd());
	const { failures, scanned } = checkPackage(root);
	if (failures.length === 0) {
		console.log(`Package check passed: ${scanned} files scanned, structure intact.`);
	} else {
		for (const { file, rule, detail } of failures) console.log(`${file}: ${rule}: ${detail}`);
		console.log(`Package check failed: ${failures.length} problem(s).`);
		process.exitCode = 1;
	}
}
