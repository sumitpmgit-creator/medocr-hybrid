// HARNESS SELF-TEST ONLY: serves bench-stub.html on :5199 and swallows POSTs to /sink.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('./bench-stub.html', import.meta.url));
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'POST') { req.resume(); req.on('end', () => res.end('{}')); return; }
  res.setHeader('content-type', 'text/html'); res.end(page);
}).listen(5199, () => console.log('stub on http://localhost:5199/bench.html'));
