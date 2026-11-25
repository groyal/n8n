// Stand-in for SAP's proxy and Agent Gateway (AGW). Records every request that leaves n8n.
// Open http://localhost:4010/_mock to see them.
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_AGW_PORT ?? 4010);
const requests = [];

const escape = (value) =>
	String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page() {
	// The spike rewrite is process-wide, so n8n's own calls (community node list) land here too.
	const rows = requests
		.filter((r) => !/(^|\.)n8n\.io$/.test(r.originalHost ?? ''))
		.slice()
		.reverse()
		.map(
			(r) => `<tr><td>${escape(r.at.slice(11, 19))}</td><td>${escape(r.method)}</td>
<td>${escape(r.originalHost)}${escape(r.url)}</td><td>${escape(r.ordID ?? 'none')}</td>
<td class="${r.authorization ? 'bad' : 'ok'}">${escape(r.authorization ?? 'none')}</td></tr>`,
		)
		.join('');
	return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Mock AGW</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left;word-break:break-all}
.ok{color:#137333}.bad{color:#c5221f;font-weight:600}</style>
<h1>Requests that left n8n</h1>
<p>Expected (approach B): no <code>Authorization</code> header and no <code>ordID</code>. AGW maps each request itself. Refreshes every 2 s.
<form method="post" action="/_mock/clear"><button>Clear</button></form></p>
<table><tr><th>Time</th><th>Method</th><th>Original target</th><th>ordID</th><th>Authorization</th></tr>${rows}</table>`;
}

createServer((req, res) => {
	if (req.url === '/_mock' || req.url === '/_mock/') {
		res.writeHead(200, { 'content-type': 'text/html' });
		return res.end(page());
	}
	if (req.url === '/_mock/requests') {
		res.writeHead(200, { 'content-type': 'application/json' });
		return res.end(JSON.stringify(requests));
	}
	if (req.url === '/_mock/clear') {
		requests.length = 0;
		res.writeHead(303, { location: '/_mock' });
		return res.end();
	}

	let body = '';
	req.on('data', (chunk) => (body += chunk));
	req.on('end', () => {
		requests.push({
			at: new Date().toISOString(),
			method: req.method,
			url: req.url,
			originalHost: req.headers['x-original-host'],
			ordID: req.headers['ordid'],
			authorization: req.headers['authorization'],
			body: body.slice(0, 500),
		});
		// A generic body that most nodes accept as an empty answer.
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: true, mock: 'agw', value: [], messages: [] }));
	});
}).listen(port, () => console.log(`Mock AGW on http://localhost:${port}/_mock`));
