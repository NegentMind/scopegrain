// Fake vantadb-mcp stdio server for tests: NDJSON JSON-RPC over stdin/stdout.
const store = new Map();
let buf = '';
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') {
      send({ jsonrpc: '2.0', id: m.id, result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'fake-vantadb', version: '0.9.0' },
        capabilities: {},
      } });
      continue;
    }
    if (m.method === 'tools/call') {
      const { name, arguments: args } = m.params;
      const k = `${args.namespace}${args.key}`;
      if (name === 'memory_get') {
        if (store.has(k)) {
          const v = { namespace: args.namespace, key: args.key, payload: store.get(k) };
          send({ jsonrpc: '2.0', id: m.id, result: {
            structuredContent: v,
            content: [{ type: 'text', text: JSON.stringify(v) }],
          } });
        } else {
          send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{
            type: 'text', text: JSON.stringify({ code: -32004, message: 'not found',
              data: { code: 'VANTADB_NOT_FOUND', retriable: false } }),
          }] } });
        }
        continue;
      }
      if (name === 'memory_put') {
        store.set(k, args.payload);
        const v = { namespace: args.namespace, key: args.key, payload: args.payload };
        send({ jsonrpc: '2.0', id: m.id, result: {
          structuredContent: v,
          content: [{ type: 'text', text: JSON.stringify(v) }],
        } });
        continue;
      }
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown tool' } });
    }
  }
});
