import net from "net";
import S5Proxy, { ProxyRequestConnectionCallback } from "./proxy";

type Socks5ProxyOptions = {
  host: string;
  port: number;
  callback?: ProxyRequestConnectionCallback;
};

const proxies: Set<S5Proxy> = new Set();

export function socks5({ host, port, callback }: Socks5ProxyOptions) {
  const server = net.createServer();
  server
    .listen(port, host)
    .on("listening", () => {
      console.log(`[ProxyServer/Socks5] Listening on`, port);
    })
    .on("error", (err) => {
      console.error("[ProxyServer/Socks5] Host error", err);
    })
    .on("connection", (socket) => {
      const proxy = new S5Proxy(socket);
      // proxies.add(proxy);
      callback && (proxy.onConnection = callback);

      socket
        .on("close", (hadError) => {
          console.log(
            `[Socks5/Connection] ${proxy.sessionId} closed`,
            hadError ? "with error" : ""
          );
          // proxies.delete(proxy);
        })
        .on("error", (err) => {
          console.error(`[Socks5/Connection] Socket ${proxy.sessionId}`, err);
        });
    });
}
