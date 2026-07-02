import { spawn } from 'child_process';
import http from 'http';

function requestConversation(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 5001, path: '/api/chat/conversations', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function waitForServer(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      requestConversation({ order_id: 'order-reuse-check', customer_name: 'E2E Tester', customer_email: 'e2e@example.com', subject: 'Order order-reuse-check', initial_message: 'probe' })
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('server did not start'));
          } else {
            setTimeout(tryConnect, 200);
          }
        });
    };
    tryConnect();
  });
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: '5001' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => output += d.toString());
  child.stderr.on('data', (d) => output += d.toString());

  try {
    await waitForServer();
    const first = await requestConversation({ order_id: 'order-reuse-check', customer_name: 'E2E Tester', customer_email: 'e2e@example.com', subject: 'Order order-reuse-check', initial_message: 'First message' });
    const second = await requestConversation({ order_id: 'order-reuse-check', customer_name: 'E2E Tester', customer_email: 'e2e@example.com', subject: 'Order order-reuse-check', initial_message: 'Second message' });
    const firstJson = JSON.parse(first.body);
    const secondJson = JSON.parse(second.body);
    console.log(JSON.stringify({ firstStatus: first.status, firstConversationId: firstJson.conversation?.id, secondStatus: second.status, secondConversationId: secondJson.conversation?.id, output }, null, 2));
  } catch (err) {
    console.error(err && err.stack || err);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
  }
})();
