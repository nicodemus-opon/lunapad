/**
 * Tests the LSP WebSocket server directly via JSON-RPC
 * No browser needed — just checks the protocol works.
 */
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:5174/api/lsp');
let msgId = 0;

function send(method, params) {
	const msg = JSON.stringify({ jsonrpc: '2.0', id: ++msgId, method, params });
	ws.send(msg);
}

const responses = new Map();
ws.on('message', (data) => {
	try {
		const msg = JSON.parse(data.toString());
		if (msg.id) responses.set(msg.id, msg);
	} catch {}
});

function waitFor(id, timeout = 3000) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout waiting for id ${id}`)), timeout);
		const check = () => {
			if (responses.has(id)) {
				clearTimeout(t);
				resolve(responses.get(id));
			} else setTimeout(check, 50);
		};
		check();
	});
}

ws.on('open', async () => {
	console.log('Connected to LSP WebSocket\n');

	// ── initialize ────────────────────────────────────────────────────────────
	send('initialize', {
		processId: process.pid,
		rootUri: null,
		capabilities: {},
		clientInfo: { name: 'test-client', version: '1.0' }
	});
	const initResp = await waitFor(1);
	const caps = initResp.result?.capabilities ?? {};
	console.log('initialize response:');
	console.log('  completionProvider:', JSON.stringify(caps.completionProvider));
	console.log('  hoverProvider:', caps.hoverProvider);
	console.log('  signatureHelpProvider:', JSON.stringify(caps.signatureHelpProvider));
	console.log('  serverInfo:', JSON.stringify(initResp.result?.serverInfo));

	// initialized notification (required by LSP spec)
	ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));

	// ── open a document ──────────────────────────────────────────────────────
	const uri = 'file:///test.sql';
	ws.send(
		JSON.stringify({
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: {
				textDocument: {
					uri,
					languageId: 'trinosql',
					version: 1,
					text: 'SELECT approx_distinct(x) FROM t'
				}
			}
		})
	);
	await new Promise((r) => setTimeout(r, 200));

	// ── hover: approx_distinct ──────────────────────────────────────────────
	send('textDocument/hover', {
		textDocument: { uri },
		position: { line: 0, character: 10 } // inside 'approx_distinct'
	});
	const hoverResp = await waitFor(2);
	const hoverVal = hoverResp.result?.contents?.value ?? 'null';
	console.log('\ntextDocument/hover (approx_distinct):');
	console.log(' ', hoverVal.slice(0, 120));
	const hoverOk = hoverVal.includes('approx_distinct');
	console.log(`  ✓ contains function name: ${hoverOk}`);

	// ── completion ───────────────────────────────────────────────────────────
	ws.send(
		JSON.stringify({
			jsonrpc: '2.0',
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri, version: 2 },
				contentChanges: [{ text: 'SELECT json_' }]
			}
		})
	);
	send('textDocument/completion', {
		textDocument: { uri },
		position: { line: 0, character: 12 }
	});
	const compResp = await waitFor(3, 5000);
	const items = compResp.result ?? [];
	const jsonFns = items.filter((i) => i.label.startsWith('json_'));
	console.log(`\ntextDocument/completion (json_*):`);
	console.log(`  total items: ${items.length}`);
	console.log(`  json_* functions: ${jsonFns.length}`);
	jsonFns.slice(0, 5).forEach((i) => console.log(`    - ${i.label}: ${i.detail}`));

	// ── signatureHelp ────────────────────────────────────────────────────────
	ws.send(
		JSON.stringify({
			jsonrpc: '2.0',
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri, version: 3 },
				contentChanges: [{ text: 'SELECT date_trunc(' }]
			}
		})
	);
	send('textDocument/signatureHelp', {
		textDocument: { uri },
		position: { line: 0, character: 18 }
	});
	const sigResp = await waitFor(4, 5000);
	const sig = sigResp.result?.signatures?.[0];
	console.log(`\ntextDocument/signatureHelp (date_trunc):`);
	console.log(`  label: ${sig?.label}`);
	console.log(`  params: ${sig?.parameters?.map((p) => p.label).join(', ')}`);

	// ── summary ──────────────────────────────────────────────────────────────
	console.log('\n── Summary ─────────────────────────────────────────');
	console.log(`  LSP initialize: ${caps.completionProvider ? '✓' : '✗'}`);
	console.log(`  Hover resolves function: ${hoverOk ? '✓' : '✗'}`);
	console.log(`  Completions returned: ${items.length > 0 ? '✓' : '✗'} (${items.length} items)`);
	console.log(`  Signature help: ${sig ? '✓' : '✗'}`);

	ws.close();
	process.exit(0);
});

ws.on('error', (e) => {
	console.error('WebSocket error:', e.message);
	process.exit(1);
});
