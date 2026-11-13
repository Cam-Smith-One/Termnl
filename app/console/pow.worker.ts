import { minePow } from "nostr-tools/nip13"
import type { UnsignedEvent } from "nostr-tools/pure"
self.onmessage = (event: MessageEvent<{ event: UnsignedEvent; difficulty: number }>) => {
  try { self.postMessage({ event: minePow(event.data.event, event.data.difficulty) }) }
  catch { self.postMessage({ error: "Proof of work failed" }) }
}
