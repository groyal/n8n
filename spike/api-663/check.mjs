// Automated end-to-end checks for the API-663 spike. Needs ./start.sh running.
// Usage: node spike/api-663/check.mjs [filter]
// Approach B: n8n stores no credential and sends no ORD ID. AGW maps each request itself.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://localhost:5681';
const MOCK = process.env.MOCK ?? 'http://localhost:4010';
const MANAGED = 'sapManagedApi';
const owner = { email: 'spike@example.com', firstName: 'Spike', lastName: 'User', password: 'SpikePassword123' };

let cookie = '';
async function call(method, path, body) {
	const res = await fetch(BASE + path, {
		method,
		headers: { 'content-type': 'application/json', cookie },
		body: body ? JSON.stringify(body) : undefined,
	});
	const setCookie = res.headers.get('set-cookie');
	if (setCookie) cookie = setCookie.split(';')[0];
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = text;
	}
	return { status: res.status, json };
}

const mockRequests = async () => (await fetch(`${MOCK}/_mock/requests`)).json();
const clearMock = () => fetch(`${MOCK}/_mock/clear`, { redirect: 'manual' });

const results = [];
const record = (area, check, verdict, detail = '') => results.push({ area, check, verdict, detail });

// --- Login -------------------------------------------------------------------
if ((await call('POST', '/rest/owner/setup', owner)).status !== 200) {
	const login = await call('POST', '/rest/login', { emailOrLdapLoginId: owner.email, password: owner.password });
	if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
}

// --- Editor types ------------------------------------------------------------
{
	const nodes = (await call('GET', '/types/nodes.json')).json;
	const creds = (await call('GET', '/types/credentials.json')).json;
	const names = creds.map((c) => c.name);
	record('Editor', 'Only the managed type is offered', names.length === 1 && names[0] === MANAGED ? 'PASS' : 'FAIL', names.join(', '));
	record('Editor', 'The managed type is shown as a fixed, disabled value', creds[0]?.systemManaged === true ? 'PASS' : 'FAIL');

	const withCreds = nodes.filter((n) => n.credentials?.length);
	const other = withCreds.filter((n) => n.credentials.some((c) => c.name !== MANAGED));
	const httpOnly = other.every((n) => n.name === 'n8n-nodes-base.httpRequest');
	record('Editor', 'Every node with credentials asks only for the managed type', httpOnly ? 'PASS' : 'FAIL',
		`${withCreds.length} descriptions, exceptions: ${[...new Set(other.map((n) => n.name))].join(', ') || 'none'}`);

	const sheets = nodes.filter((n) => n.name === 'n8n-nodes-base.googleSheets').at(-1);
	const sheetsAuth = sheets.properties.find((p) => p.name === 'authentication')?.options?.map((o) => o.value) ?? [];
	record('Editor', 'Google Sheets hides "Service Account"', sheetsAuth.includes('serviceAccount') ? 'FAIL' : 'PASS', sheetsAuth.join(', '));
}

// --- Credentials -------------------------------------------------------------
// n8n builds the managed credential at run time. No record is stored, and none can be created.
for (const [type, data] of [[MANAGED, {}], ['slackApi', { accessToken: 'xoxb-real' }]]) {
	const created = await call('POST', '/rest/credentials', { name: `Try ${type}`, type, data });
	record('Safeguard', `Creating a "${type}" credential is refused`, created.status === 400 ? 'PASS' : 'FAIL', `${created.status} ${created.json?.message ?? ''}`);
}

// --- Safeguard: a real credential stored outside the API ---------------------
// The CLI import writes to the database directly and is not blocked yet (known gap).
// The run-time guard must still never use it.
const REAL_ID = 'spikeRealSlack01';
if (!(await call('GET', '/rest/credentials')).json.data.some((c) => c.id === REAL_ID)) {
	const file = join(tmpdir(), 'api-663-real-credential.json');
	writeFileSync(file, JSON.stringify([{ id: REAL_ID, name: 'Real Slack (imported)', type: 'slackApi', data: { accessToken: 'xoxb-real-imported' } }]));
	execFileSync('./bin/n8n', ['import:credentials', `--input=${file}`], {
		cwd: join(KIT, '../../packages/cli'),
		env: { ...process.env, N8N_USER_FOLDER: join(KIT, '.data') },
		stdio: 'ignore',
	});
}
const imported = (await call('GET', '/rest/credentials')).json.data.some((c) => c.id === REAL_ID);
record('Safeguard', 'CLI import of another credential type is blocked', imported ? 'KNOWN GAP' : 'PASS',
	imported ? 'import:credentials still stores it; block it in managed mode' : '');

// --- Node cases --------------------------------------------------------------
const rl = (value) => ({ __rl: true, mode: 'id', value });
const ord = (name, v = 'v1') => `sap.thirdparty:apiResource:${name}:${v}`;

const cases = [
	{ label: 'HTTP Request (Managed by SAP)',
		node: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, parameters: { url: 'https://api.example.com/items',
			authentication: 'predefinedCredentialType', nodeCredentialType: MANAGED } } },
	{ label: 'Slack (requestWithAuthentication)', ordID: ord('SLACK'),
		node: { type: 'n8n-nodes-base.slack', typeVersion: 2.3, parameters: { authentication: 'accessToken', resource: 'message',
			operation: 'post', select: 'channel', channelId: rl('C0123456789'), text: 'hello' } } },
	{ label: 'Outlook (OAuth2)', ordID: ord('OUTLOOK'),
		node: { type: 'n8n-nodes-base.microsoftOutlook', typeVersion: 2, parameters: { resource: 'message', operation: 'getAll', returnAll: false, limit: 1 } } },
	{ label: 'Teams (direct requestOAuth2)', ordID: ord('TEAMS'),
		node: { type: 'n8n-nodes-base.microsoftTeams', typeVersion: 2, parameters: { resource: 'channel', operation: 'getAll',
			teamId: rl('61165b04-e4cc-4026-b43f-926b4e2a7182') } } },
	{ label: 'Jina AI (declarative node)', ordID: ord('JINA'),
		node: { type: 'n8n-nodes-base.jinaAi', typeVersion: 1, parameters: { resource: 'reader', operation: 'read', url: 'https://example.com' } } },
	{ label: 'Jira (base URL from a credential field)', ordID: ord('JIRA'),
		node: { type: 'n8n-nodes-base.jira', typeVersion: 1, parameters: { jiraVersion: 'cloud', resource: 'issue', operation: 'get', issueKey: 'ABC-1' } } },
	{ label: 'Community-style node (own credential type)', ordID: ord('ACME_COMMUNITY'),
		node: { type: 'CUSTOM.acmeCommunity', typeVersion: 1, parameters: { query: 'sap' } } },
	{ label: 'Google Sheets (OAuth2)', ordID: ord('GOOGLE_SHEETS', 'v4'), requestOnly: true,
		node: { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, parameters: { authentication: 'oAuth2', resource: 'sheet',
			operation: 'read', documentId: rl('1abcDEF'), sheetName: rl('0') } } },
	{ label: 'Telegram (secret in the URL path)', expectNoRequest: true, knownGap: 'empty token: n8n refuses a URL with an empty path segment, so nothing is sent',
		node: { type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'chat', operation: 'get', chatId: '123' } } },
	{ label: 'Freshdesk (node builds its own Basic auth)', ordID: ord('FRESHDESK'), agwNote: 'node sends Basic auth with an empty key; AGW replaces it',
		node: { type: 'n8n-nodes-base.freshdesk', typeVersion: 1, parameters: { resource: 'ticket', operation: 'get', ticketId: '1' } } },
	{ label: 'Google Sheets (service account, node signs a token)', expectNoRequest: true, knownGap: 'fails before sending; editor hides this option',
		node: { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, parameters: { authentication: 'serviceAccount', resource: 'sheet',
			operation: 'read', documentId: rl('1abcDEF'), sheetName: rl('0') } } },
	{ label: 'Node with a real (imported) Slack credential: n8n ignores it', ordID: ord('SLACK'), safeguard: true,
		credentials: { slackApi: { id: REAL_ID, name: 'Real Slack (imported)' } },
		node: { type: 'n8n-nodes-base.slack', typeVersion: 2.3, parameters: { authentication: 'accessToken', resource: 'message',
			operation: 'post', select: 'channel', channelId: rl('C0123456789'), text: 'hello' } } },
];

async function runCase(c) {
	await clearMock();
	const wf = await call('POST', '/rest/workflows', {
		name: `spike check: ${c.label}`,
		nodes: [
			{ name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Target', position: [240, 0], ...(c.credentials ? { credentials: c.credentials } : {}), ...c.node },
		],
		connections: { Start: { main: [[{ node: 'Target', type: 'main', index: 0 }]] } },
		settings: {},
		active: false,
	});
	if (wf.status !== 200) return { error: `save ${wf.status}` };
	const run = await call('POST', `/rest/workflows/${wf.json.data.id}/run`, { triggerToStartFrom: { name: 'Start' } });
	if (run.status !== 200) return { error: `run ${run.status}` };
	let exec;
	for (let i = 0; i < 40; i++) {
		await new Promise((r) => setTimeout(r, 250));
		exec = (await call('GET', `/rest/executions/${run.json.data.executionId}`)).json?.data;
		if (exec && !['running', 'new'].includes(exec.status)) break;
	}
	return { status: exec?.status, requests: await mockRequests() };
}

const filter = process.argv[2]?.toLowerCase();
for (const c of cases) {
	if (filter && !c.label.toLowerCase().includes(filter)) continue;
	const r = await runCase(c);
	const area = c.safeguard ? 'Safeguard' : 'Node';
	if (r.error) {
		record(area, c.label, 'FAIL', r.error);
		continue;
	}
	const reqs = r.requests;
	if (c.expectNoRequest) {
		const ok = r.status === 'error' && reqs.length === 0;
		record(area, c.label, ok ? (c.knownGap ? 'KNOWN GAP' : 'PASS') : 'FAIL', `${r.status}, ${reqs.length} requests${c.knownGap ? ` - ${c.knownGap}` : ''}`);
		continue;
	}
	const first = reqs[0];
	const requestOk = first && first.ordID === undefined;
	const statusOk = c.requestOnly || r.status === 'success';
	const detail = first ? `${first.method} ${first.originalHost}${first.url} ordID=${first.ordID ?? 'none'} auth=${first.authorization ?? 'none'}` : 'no request';
	if (!requestOk || !statusOk) record(area, c.label, 'FAIL', `${r.status}; ${detail}`);
	else if (c.knownGap) record(area, c.label, 'KNOWN GAP', `${c.knownGap}; ${detail}`);
	else if (c.agwNote) record(area, c.label, 'PASS', `${c.agwNote}; ${detail}`);
	else record(area, c.label, first.authorization ? 'FAIL' : 'PASS', detail);
}

// --- Publish ------------------------------------------------------------------
// The server checks required credentials on publish. In managed mode no slot is filled.
if (!filter || 'publish'.includes(filter)) {
	const wf = await call('POST', '/rest/workflows', {
		name: 'spike check: publish a workflow with no credential',
		nodes: [
			{ name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: 'hours' }] } } },
			{ name: 'Target', position: [240, 0], ...cases[1].node },
		],
		connections: { Schedule: { main: [[{ node: 'Target', type: 'main', index: 0 }]] } },
		settings: {},
		active: false,
	});
	const published = wf.status === 200 && (await call('POST', `/rest/workflows/${wf.json.data.id}/activate`, { versionId: wf.json.data.versionId }));
	record('Publish', 'Publish a workflow whose nodes have no credential', published?.status === 200 ? 'PASS' : 'FAIL',
		`${published?.status ?? wf.status} ${published?.json?.message ?? ''}`);
	if (published?.status === 200) await call('POST', `/rest/workflows/${wf.json.data.id}/deactivate`, {});
}

console.table(results);
const failed = results.filter((r) => r.verdict === 'FAIL').length;
console.log(failed ? `${failed} check(s) failed` : 'All checks passed (known gaps are expected)');
process.exit(failed ? 1 : 0);
