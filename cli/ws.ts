import WebSocket from "ws";
import { useWebSocketImplementation as installWebSocket } from "nostr-tools/pool";

// A relay that never answers is closed mid-handshake, and `ws` then emits an "error" event. With nobody
// listening Node treats that as fatal, so one dead relay would take the whole process down.
class QuietWebSocket extends WebSocket {
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args);
    this.on("error", () => undefined);
  }
}
installWebSocket(QuietWebSocket);
