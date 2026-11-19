// Fake vantadb-mcp stdio server for tests: NDJSON JSON-RPC over stdin/stdout.
// Persists to VANTADB_STORAGE_PATH/fake-store.json so records survive across
// spawns, like the real server does with its storage path.
import fs from 'node:fs';
import path from 'node:path';
const storeFile = process.env.VANTADB_STORAGE_PATH
  ? path.join(process.env.VANTADB_STORAGE_PATH, 'fake-store.json') : null;
const store = new Map(storeFile && fs.existsSync(storeFile)
  ? Object.entries(JSON.parse(fs.readFileSync(storeFile, 'utf8'))) : []);
function persist() {
  if (storeFile) {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(Object.fromEntries(store)));
  }
}
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
      const k = JSON.stringify([args.namespace, args.key]);
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
        persist();
        const v = { namespace: args.namespace, key: args.key, payload: args.payload };
        send({ jsonrpc: '2.0', id: m.id, result: {
          structuredContent: v,
          content: [{ type: 'text', text: JSON.stringify(v) }],
        } });
        continue;
      }
      if (name === 'memory_list') {
        const hits = [...store.entries()]
          .map(([sk]) => JSON.parse(sk))
          .filter(([ns]) => ns === args.namespace)
          .map(([ns, key]) => ({ namespace: ns, key }));
        send({ jsonrpc: '2.0', id: m.id, result: {
          structuredContent: { hits, byte_count: hits.length, truncated: false },
          content: [{ type: 'text', text: JSON.stringify(hits) }],
        } });
        continue;
      }
      if (name === 'memory_search') {
        const hits = [...store.entries()]
          .map(([sk, v]) => [JSON.parse(sk), v])
          .filter(([[ns], v]) => ns === args.namespace
            && (!args.text_query || JSON.stringify(v).includes(args.text_query)))
          .map(([[, key], v]) => ({ key, payload: v, score: 1 }));
        const top = hits.slice(0, args.top_k ?? 10);
        send({ jsonrpc: '2.0', id: m.id, result: {
          structuredContent: { hits: top, byte_count: top.length,
            truncated: false, abstained: false },
          content: [{ type: 'text', text: JSON.stringify(top) }],
        } });
        continue;
      }
      if (name === 'memory_list_namespaces') {
        const namespaces = [...new Set([...store.keys()]
          .map((sk) => JSON.parse(sk)[0]))].sort();
        send({ jsonrpc: '2.0', id: m.id, result: {
          structuredContent: { namespaces },
          content: [{ type: 'text', text: JSON.stringify(namespaces) }],
        } });
        continue;
      }
      if (name === 'memory_recall') {
        // Mimic the real pool: l1/* namespaces, agent scope filters
        // agent_id == 'default', session/team analogous.
        const scope = args.scope ?? 'agent';
        const recalled = [...store.entries()]
          .map(([sk, v]) => [JSON.parse(sk), v])
          .filter(([[ns]]) => ns.startsWith('l1/'))
          .map(([[ns, key], payload]) => {
            let rec;
            try { rec = JSON.parse(payload); }
            catch { rec = { content: payload, agent_id: null, team_id: null }; }
            return { ns, key, rec };
          })
          .filter(({ rec }) => {
            if (scope === 'agent') return rec.agent_id === 'default';
            if (scope === 'team') return rec.team_id === 'default';
            return true;
          })
          .filter(({ rec }) => !args.query
            || String(rec.content).includes(args.query))
          .map(({ rec }) => ({ content: rec.content, score: 0.9,
            type: rec.type ?? 'episodic' }))
          .slice(0, args.top_k ?? 5);
        const v = { prepend_context: recalled.length ? 'ctx' : null,
          recalled, effective_mode: 'keyword' };
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
