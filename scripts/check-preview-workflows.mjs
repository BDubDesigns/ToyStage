// Exercise the actual inline workflow scripts with adversarial GitHub/API/filesystem
// fixtures, without credentials, network calls, or application dependencies.
// YAML syntax/expression validation is a separate actionlint check.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const build = await readFile(new URL('../.github/workflows/preview-build.yml', import.meta.url), 'utf8');
const publish = await readFile(new URL('../.github/workflows/preview-publish.yml', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function script(source, name) {
  const step = source.indexOf(`      - name: ${name}\n`);
  assert.ok(step >= 0, `Missing workflow step ${name}`);
  const rest = source.slice(step);
  const block = rest.match(/          script: \|\n((?:            .*\n|\n)+)/);
  assert.ok(block, `Missing literal script in ${name}`);
  return block[1].replace(/^            /gm, '');
}
const resolve = script(build, 'Resolve an open PR and immutable head commit');
const authenticate = script(publish, 'Authenticate the build run and artifact identity');
const staticContent = script(publish, 'Validate static content and add trusted MIME headers');
const provision = script(publish, 'Provision or verify the isolated Direct Upload project');
const verify = script(publish, 'Verify actual HTTPS deployment and Pose assets before announcing');
const repo = { owner: 'BDubDesigns', repo: 'ToyStage' };
const fullName = 'BDubDesigns/ToyStage';
const sha = 'a'.repeat(40);
const pr = {
  number: 27, state: 'open',
  head: { sha, ref: 'feat/23-pose-mode', repo: { id: 123, full_name: fullName } },
  base: { ref: 'main', repo: { id: 123, full_name: fullName } },
};
const run = {
  id: 42, conclusion: 'success', repository: { full_name: fullName },
  head_repository: { full_name: fullName }, head_sha: sha, head_branch: pr.head.ref,
  path: '.github/workflows/preview-build.yml', event: 'pull_request', pull_requests: [pr],
};
const artifact = { id: 99, name: `preview-dist-pr-27-${sha}`, expired: false, size_in_bytes: 1000 };
function fixture({ runData = run, prData = pr, artifacts = [artifact], env = {}, event = 'workflow_run', fetch } = {}) {
  const outputs = {};
  const summary = { addHeading() { return this; }, addRaw() { return this; }, addLink() { return this; }, async write() {} };
  return {
    outputs, env,
    context: { repo, eventName: event, ref: 'refs/heads/main', payload: { workflow_run: { id: 42 }, pull_request: pr } },
    github: { rest: {
      actions: { getWorkflowRun: async () => ({ data: runData }), listWorkflowRunArtifacts: () => {} },
      pulls: { get: async () => ({ data: prData }) },
    }, paginate: async () => artifacts },
    core: { setOutput: (key, value) => { outputs[key] = value; }, summary, info() {} }, fetch,
  };
}
async function execute(code, f) {
  await new AsyncFunction('context', 'github', 'core', 'process', 'require', 'fetch', 'setTimeout',
    'URL', 'AbortSignal', 'Buffer', code)(f.context, f.github, f.core, { env: f.env }, require,
      f.fetch ?? (() => { throw new Error('Unexpected network request'); }),
      fn => { fn(); }, URL, AbortSignal, Buffer);
  return f.outputs;
}
const copy = value => structuredClone(value);

test('build is secret-free; publisher has no checkout, shell, npm scripts, or cache', () => {
  assert.doesNotMatch(build, /secrets\.|CLOUDFLARE|pull_request_target|:\s*write\b/);
  assert.doesNotMatch(publish, /uses: actions\/checkout|\brun:|cache: npm|pull_request_target:/);
  assert.match(build, /persist-credentials: false/);
  assert.match(build, /ref: \$\{\{ needs.resolve.outputs.sha \}\}/);
  assert.match(publish, /run-id: \$\{\{ github.run_id \}\}/);
  assert.match(publish, /artifact_id: \$\{\{ steps.sanitized.outputs.artifact-id \}\}/);
  for (const source of [build, publish]) {
    for (const [, ref] of source.matchAll(/uses: ([^\s]+) /g)) assert.match(ref, /@[0-9a-f]{40}$/);
  }
});

test('manual #27 build resolves exact SHA from main', async () => {
  const f = fixture({ event: 'workflow_dispatch', env: { REQUESTED_PR: '27' } });
  assert.deepEqual(await execute(resolve, f), { pr_number: '27', sha, repository: fullName });
});
for (const input of ['27; echo bad', '$(env)', '0', '-27', '2.7', '9007199254740992']) {
  test(`manual input rejected: ${input}`, async () => {
    await assert.rejects(execute(resolve, fixture({ event: 'workflow_dispatch', env: { REQUESTED_PR: input } })), /positive integer/);
  });
}
test('manual build refuses feature-branch workflow, fork, closed PR, and changed event head', async () => {
  const f = fixture({ event: 'workflow_dispatch', env: { REQUESTED_PR: '27' } });
  f.context.ref = 'refs/heads/untrusted';
  await assert.rejects(execute(resolve, f), /trusted workflow from main/);
  const fork = copy(pr); fork.head.repo.full_name = 'someone/ToyStage';
  await assert.rejects(execute(resolve, fixture({ prData: fork, event: 'workflow_dispatch', env: { REQUESTED_PR: '27' } })), /same-repository/);
  const closed = copy(pr); closed.state = 'closed';
  await assert.rejects(execute(resolve, fixture({ prData: closed, event: 'workflow_dispatch', env: { REQUESTED_PR: '27' } })), /still-open/);
  const moved = copy(pr); moved.head.sha = 'b'.repeat(40);
  await assert.rejects(execute(resolve, fixture({ prData: moved, event: 'pull_request' })), /head changed/);
});

test('only successful run-associated current PR artifact is accepted', async () => {
  assert.deepEqual(await execute(authenticate, fixture()), { pr_number: '27', sha, artifact_id: '99' });
});
for (const [label, mutate] of [
  ['failed run', r => { r.conclusion = 'failure'; }],
  ['fork run', r => { r.head_repository.full_name = 'someone/ToyStage'; }],
  ['different workflow', r => { r.path = '.github/workflows/evil.yml'; }],
  ['main push', r => { r.event = 'push'; }],
  ['wrong commit', r => { r.head_sha = 'b'.repeat(40); }],
  ['wrong branch', r => { r.head_branch = 'another-branch'; }],
  ['missing PR association', r => { r.pull_requests = []; }],
  ['different PR association', r => { r.pull_requests[0].number = 8; }],
]) {
  test(`publisher refuses ${label}`, async () => {
    const changed = copy(run); mutate(changed);
    await assert.rejects(execute(authenticate, fixture({ runData: changed })));
  });
}
for (const [label, mutate] of [
  ['closed PR', p => { p.state = 'closed'; }],
  ['fork PR', p => { p.head.repo.full_name = 'someone/ToyStage'; }],
  ['stale PR commit', p => { p.head.sha = 'b'.repeat(40); }],
  ['other base', p => { p.base.ref = 'release'; }],
]) {
  test(`publisher refuses ${label}`, async () => {
    const changed = copy(pr); mutate(changed);
    await assert.rejects(execute(authenticate, fixture({ prData: changed })), /closed, forked, or superseded/);
  });
}
test('artifact tampering, expiration, ambiguous artifact and size are rejected', async () => {
  for (const artifacts of [[], [artifact, { ...artifact, id: 100 }], [{ ...artifact, expired: true }],
    [{ ...artifact, name: `preview-dist-pr-27-${'b'.repeat(40)}` }],
    [{ ...artifact, size_in_bytes: 101 * 1024 * 1024 }],
    [{ ...artifact, name: 'preview-dist-pr-27-$(env)' }]]) {
    await assert.rejects(execute(authenticate, fixture({ artifacts })));
  }
});
test('manual source must be main and its GitHub run title must match artifact PR', async () => {
  const manual = { ...run, event: 'workflow_dispatch', head_branch: 'main', display_title: 'Preview PR #27' };
  assert.equal((await execute(authenticate, fixture({ runData: manual }))).pr_number, '27');
  for (const altered of [{ ...manual, head_branch: 'untrusted' }, { ...manual, display_title: 'Preview PR #28' }]) {
    await assert.rejects(execute(authenticate, fixture({ runData: altered })), /Manual source run/);
  }
});

async function staticFixture(callback) {
  const temp = await mkdtemp(path.join(tmpdir(), 'toystage-preview-check-'));
  const root = path.join(temp, 'preview-dist');
  await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Preview</title>');
  try { await callback(temp, root); } finally { await rm(temp, { recursive: true, force: true }); }
}
test('static assets pass; untrusted MIME headers are replaced', async () => {
  await staticFixture(async (temp, root) => {
    await writeFile(path.join(root, '_headers'), 'malicious override');
    await execute(staticContent, fixture({ env: { RUNNER_TEMP: temp } }));
    const headers = await readFile(path.join(root, '_headers'), 'utf8');
    assert.match(headers, /Content-Type: application\/wasm/);
    assert.match(headers, /Content-Type: application\/octet-stream/);
    assert.doesNotMatch(headers, /malicious/);
  });
});
for (const name of ['_worker.js', 'functions', '_routes.json', '_redirects', 'wrangler.toml', 'wrangler.jsonc', 'package.json', '.npmrc', 'evil name.js']) {
  test(`static artifact refuses ${name}`, async () => {
    await staticFixture(async (temp, root) => {
      await writeFile(path.join(root, name), 'untrusted');
      await assert.rejects(execute(staticContent, fixture({ env: { RUNNER_TEMP: temp } })), /forbidden/);
    });
  });
}
test('static artifact refuses symlinks, oversize assets, and missing index', async () => {
  await staticFixture(async (temp, root) => {
    await symlink('/etc/passwd', path.join(root, 'link'));
    await assert.rejects(execute(staticContent, fixture({ env: { RUNNER_TEMP: temp } })), /no links/);
    await rm(path.join(root, 'link'));
    await writeFile(path.join(root, 'large.wasm'), '');
    await truncate(path.join(root, 'large.wasm'), 25 * 1024 * 1024 + 1);
    await assert.rejects(execute(staticContent, fixture({ env: { RUNNER_TEMP: temp } })), /25 MiB/);
    await rm(path.join(root, 'large.wasm'));
    await rm(path.join(root, 'index.html'));
    await assert.rejects(execute(staticContent, fixture({ env: { RUNNER_TEMP: temp } })));
  });
});

const project = { name: 'toystage-previews', production_branch: 'main', subdomain: 'toystage-previews-unique.pages.dev', domains: [] };
const credentials = { CLOUDFLARE_API_TOKEN: 'dummy-test-value', CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32) };
const response = (status, result) => ({ status, ok: status >= 200 && status < 300,
  json: async () => ({ success: status >= 200 && status < 300, result }) });
test('explicit provisioning creates one empty project without deployments or DNS', async () => {
  const calls = [];
  await execute(provision, fixture({ event: 'workflow_dispatch', env: credentials, fetch: async (url, options) => {
    calls.push({ url, options });
    return response(calls.length === 1 ? 404 : 200, project);
  } }));
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/pages\/projects\/toystage-previews$/);
  assert.match(calls[1].url, /\/pages\/projects$/);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'toystage-previews', production_branch: 'main' });
});
test('reuse does not create a duplicate; automatic publication never provisions', async () => {
  let calls = 0;
  await execute(provision, fixture({ event: 'workflow_dispatch', env: credentials, fetch: async () => { calls++; return response(200, project); } }));
  assert.equal(calls, 1);
  await assert.rejects(execute(provision, fixture({ env: credentials, fetch: async () => response(404) })), /Run this publisher manually/);
});
test('Cloudflare permission errors and conflicting project configuration fail closed', async () => {
  await assert.rejects(execute(provision, fixture({ env: credentials, fetch: async () => response(403) })), /HTTP 403/);
  for (const altered of [{ ...project, production_branch: 'pr-27' }, { ...project, name: 'production' },
    { ...project, source: { type: 'github' } }, { ...project, domains: ['toystage.qcfailed.com'] }]) {
    await assert.rejects(execute(provision, fixture({ env: credentials, fetch: async () => response(200, altered) })), /Refusing project/);
  }
});

test('HTTPS smoke checks reject wrong MIME, fallback HTML, redirects, and guessed hosts', async () => {
  await staticFixture(async (temp, root) => {
    await mkdir(path.join(root, 'pose', 'wasm'), { recursive: true });
    await writeFile(path.join(root, 'pose', 'wasm', 'vision.wasm'), 'wasm-fixture');
    await writeFile(path.join(root, 'pose', 'model.task'), 'model-fixture');
    const env = { RUNNER_TEMP: temp, PR_NUMBER: '27', PAGES_ENVIRONMENT: 'preview',
      DEPLOYMENT_URL: 'https://abcdef.toystage-previews-unique.pages.dev',
      ALIAS_URL: 'https://pr-27.toystage-previews-unique.pages.dev' };
    const serve = async url => {
      const file = new URL(url).pathname.slice(1);
      const bytes = await readFile(path.join(root, file));
      return { status: 200, headers: { get: () => file.endsWith('.wasm') ? 'application/wasm' :
        file.endsWith('.task') ? 'application/octet-stream' : 'text/html; charset=utf-8' },
        arrayBuffer: async () => bytes };
    };
    assert.equal((await execute(verify, fixture({ env, fetch: serve }))).alias, `${env.ALIAS_URL}/`);
    for (const fetch of [async () => ({ status: 302, headers: { get: () => '' } }),
      async url => ({ ...await serve(url), headers: { get: () => 'text/html' } }),
      async url => ({ ...await serve(url), arrayBuffer: async () => Buffer.from('fallback HTML') })]) {
      await assert.rejects(execute(verify, fixture({ env, fetch })), /verification failed/);
    }
    for (const changed of [{ ...env, ALIAS_URL: 'https://pr-28.toystage-previews-unique.pages.dev' },
      { ...env, DEPLOYMENT_URL: 'https://toystage.qcfailed.com' }, { ...env, PAGES_ENVIRONMENT: 'production' }]) {
      await assert.rejects(execute(verify, fixture({ env: changed, fetch: serve })));
    }
  });
});
