import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const getAvailablePort = async () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a free port'));
        return;
      }

      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

const spawnNpm = (args: string[], extraEnv: Record<string, string> = {}) =>
  spawn(npmCommand, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

const waitForUrl = async (url: string, timeoutMs = 60_000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const stopProcess = (child: ReturnType<typeof spawnNpm> | null | undefined) => {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
};

let serverProcess: ReturnType<typeof spawnNpm> | undefined;
let clientProcess: ReturnType<typeof spawnNpm> | undefined;

try {
  const serverPort = process.env.SERVER_TEST_PORT || String(await getAvailablePort());
  const clientPort = process.env.CLIENT_TEST_PORT || String(await getAvailablePort());
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const clientUrl = `http://127.0.0.1:${clientPort}`;

  serverProcess = spawnNpm(['run', 'server:test'], {
    PORT: serverPort,
  });
  await waitForUrl(serverUrl, 60_000);

  clientProcess = spawnNpm(['run', 'client:test'], {
    CLIENT_TEST_PORT: clientPort,
    VITE_API_PROXY_TARGET: serverUrl,
  });
  await waitForUrl(clientUrl, 60_000);

  const resolveProcess = spawnNpm(['run', 'test:resolve'], {
    STOCK_TEST_BASE_URL: serverUrl,
  });
  const resolveExitCode: number = await new Promise((resolve) => {
    resolveProcess.on('exit', (code) => resolve(code ?? 1));
  });

  if (resolveExitCode !== 0) {
    stopProcess(clientProcess);
    stopProcess(serverProcess);
    process.exit(resolveExitCode);
  }

  const testProcess = spawnNpm(['exec', 'playwright', 'test'], {
    PLAYWRIGHT_BASE_URL: clientUrl,
  });

  const exitCode: number = await new Promise((resolve) => {
    testProcess.on('exit', (code) => resolve(code ?? 1));
  });

  stopProcess(clientProcess);
  stopProcess(serverProcess);
  process.exit(exitCode);
} catch (error) {
  console.error(error);
  stopProcess(clientProcess);
  stopProcess(serverProcess);
  process.exit(1);
}
