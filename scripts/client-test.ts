import { createServer } from 'vite';

const clientPort = Number(process.env.CLIENT_TEST_PORT || '4174');
process.env.VITE_API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3002';

const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: clientPort,
  },
});

await server.listen();
server.printUrls();

const closeServer = async () => {
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => {
  void closeServer();
});

process.on('SIGTERM', () => {
  void closeServer();
});
