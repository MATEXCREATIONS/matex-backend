import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.CHAT_TEST_PORT || '5002';
const HOST = '127.0.0.1';

function requestConversation(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: HOST, port: Number(PORT), path: '/api/chat/conversations', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
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
          } else setTimeout(tryConnect, 200);
        });
    };
    tryConnect();
  });
}

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (d) => output += d.toString());
  child.stderr.on('data', (d) => output += d.toString());

  try {
    await waitForServer();
    const first = await requestConversation({ order_id: 'order-reuse-check', customer_name: 'E2E Tester', customer_email: 'e2e@example.com', subject: 'Order order-reuse-check', initial_message: 'First message' });
    const second = await requestConversation({ order_id: 'order-reuse-check', customer_name: 'E2E Tester', customer_email: 'e2e@example.com', subject: 'Order order-reuse-check', initial_message: 'Second message' });
    const firstJson = JSON.parse(first.body);
    const secondJson = JSON.parse(second.body);

    if (first.status < 200 || first.status >= 300 || second.status < 200 || second.status >= 300) {
      throw new Error(`Unexpected status codes: first=${first.status}, second=${second.status}`);
    }
    if (!firstJson?.success || !secondJson?.success) {
      throw new Error('Server did not return success for both requests');
    }
    if (String(firstJson.conversation?.id || '') !== String(secondJson.conversation?.id || '')) {
      throw new Error('Conversation reuse failed');
    }

    console.log(JSON.stringify({
      firstStatus: first.status,
      firstConversationId: firstJson.conversation?.id,
      secondStatus: second.status,
      secondConversationId: secondJson.conversation?.id,
      output
    }, null, 2));
  } catch (err) {
    console.error(err && err.stack || err);
    process.exitCode = 1;
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
})();
