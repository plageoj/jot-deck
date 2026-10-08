#!/usr/bin/env node
// Request at most one queued CodeRabbit review per run. Intended to run hourly
// from cron on a maintainer's machine (see coderabbit-review-queue-cron.sh).
//
// Comments must come from a human account, so the token defaults to the
// maintainer's `gh auth token`. Override with GH_TOKEN.
// Pass --dry-run to log comment writes instead of performing them.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { run } = require("./coderabbit-review-queue.js");

const API = "https://api.github.com";

function resolveRepo() {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot parse GitHub repository from origin URL: ${url}`);
  return { owner: match[1], repo: match[2] };
}

function resolveToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

function createGithub(token) {
  async function request(method, path, { query, body } = {}) {
    const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`${method} ${url.pathname} failed: ${response.status} ${await response.text()}`);
    }
    return { data: await response.json(), headers: response.headers };
  }

  // Each endpoint takes Octokit-style params and returns { data, headers }.
  const endpoint = (method, template, bodyKeys = []) => async params => {
    const rest = { ...params };
    const path = template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = rest[key];
      delete rest[key];
      return encodeURIComponent(value);
    });
    const body = bodyKeys.length
      ? Object.fromEntries(bodyKeys.map(key => [key, rest[key]]))
      : undefined;
    bodyKeys.forEach(key => delete rest[key]);
    return request(method, path, { query: rest, body });
  };

  return {
    rest: {
      issues: {
        listComments: endpoint("GET", "/repos/{owner}/{repo}/issues/{issue_number}/comments"),
        createComment: endpoint("POST", "/repos/{owner}/{repo}/issues/{issue_number}/comments", ["body"]),
        updateComment: endpoint("PATCH", "/repos/{owner}/{repo}/issues/comments/{comment_id}", ["body"]),
      },
      pulls: {
        list: endpoint("GET", "/repos/{owner}/{repo}/pulls"),
        get: endpoint("GET", "/repos/{owner}/{repo}/pulls/{pull_number}"),
        listReviews: endpoint("GET", "/repos/{owner}/{repo}/pulls/{pull_number}/reviews"),
      },
      checks: {
        // The check-runs endpoint wraps its items; unwrap so paginate sees an array.
        listForRef: async params => {
          const result = await endpoint("GET", "/repos/{owner}/{repo}/commits/{ref}/check-runs")(params);
          return { ...result, data: result.data.check_runs };
        },
      },
      repos: {
        listCommitStatusesForRef: endpoint("GET", "/repos/{owner}/{repo}/commits/{ref}/statuses"),
        getCommit: endpoint("GET", "/repos/{owner}/{repo}/commits/{ref}"),
      },
    },
    async paginate(method, params) {
      const items = [];
      for (let page = 1; ; page++) {
        const { data, headers } = await method({ ...params, page });
        items.push(...data);
        if (!/rel="next"/.test(headers.get("link") ?? "")) return items;
      }
    },
  };
}

const log = (stream, level) => message =>
  stream.write(`${new Date().toISOString()} ${level} ${message}\n`);

const core = {
  info: log(process.stdout, "INFO"),
  warning: log(process.stderr, "WARN"),
};

const github = createGithub(resolveToken());
if (process.argv.includes("--dry-run")) {
  github.rest.issues.createComment = async ({ issue_number, body }) => {
    core.info(`[dry-run] would comment on #${issue_number}: ${body.split("\n")[0]}`);
    return { data: { id: 0 } };
  };
  github.rest.issues.updateComment = async ({ comment_id }) => {
    core.info(`[dry-run] would update comment ${comment_id}`);
    return { data: {} };
  };
}

try {
  await run({ github, context: { repo: resolveRepo() }, core });
} catch (error) {
  log(process.stderr, "ERROR")(error.stack ?? String(error));
  process.exitCode = 1;
}
