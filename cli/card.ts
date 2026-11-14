/**
 * The message card shown in chat by hosts that support MCP Apps (Claude, ChatGPT, VS Code).
 * The host renders this page in a sandboxed frame and hands it the tool result; hosts without
 * MCP Apps ignore it and the agent falls back to the Markdown layout in mcp.ts.
 *
 * Everything from the other party is written with textContent, never as HTML. Buttons post a
 * chat message that names the request id only, so peer text is never replayed as the owner's words.
 * No backticks or dollar-braces inside the page: it lives in a template string.
 */
export const CARD_URI = "ui://termnl/messages.html";
export const CARD_MIME = "text/html;profile=mcp-app";
export const CARD_META = { ui: { resourceUri: CARD_URI }, "ui/resourceUri": CARD_URI };

export const CARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termnl</title>
<style>
:root{--page:transparent;--panel:#fff;--ink:#0c1f17;--body:#3a4a42;--muted:#66736b;--accent:#0b6b43;--on:#fff;--line:#e1e7e2;--tint:#e6f1eb;--warn:#7a5200;--warnbg:#fff8e6;--warnline:#ecd9a6;--danger:#b42318}
:root[data-theme=dark]{--panel:#0f1713;--ink:#e6f1eb;--body:#b7c7be;--muted:#8a9a91;--accent:#4ade80;--on:#04130b;--line:#22332a;--tint:#14261c;--warn:#eab308;--warnbg:#1f1a08;--warnline:#57430f;--danger:#f87171}
*{box-sizing:border-box}
body{margin:0;padding:2px;background:var(--page);color:var(--body);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.head{display:flex;align-items:center;gap:8px;margin:2px 2px 10px;min-height:32px;color:var(--muted);font-size:12px;letter-spacing:.04em;text-transform:uppercase}
.head b{color:var(--accent);font-family:ui-monospace,Menlo,monospace;letter-spacing:0;text-transform:none;font-size:13px}
.msg{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:10px}
.top{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:0;border-radius:8px;background:transparent;text-align:left;font-weight:400;color:inherit}
.chev{flex:none;color:var(--muted);transition:transform .15s}
.msg.open .chev{transform:rotate(90deg)}
.msg:not(.open) .details{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;color:var(--muted)}
.msg:not(.open) .more{display:none}
.msg.new .subject::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:1px}
.bar .said{margin:0 2px 10px}
.said{margin-top:10px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
@media (prefers-reduced-motion:reduce){.chev{transition:none}}
.av{flex:none;width:36px;height:36px;border-radius:50%;background:var(--tint);color:var(--accent);display:grid;place-items:center;font-weight:700}
.who{min-width:0;flex:1}
.name{color:var(--ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.when{color:var(--muted);font-size:12px}
.chip{flex:none;border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--accent);background:var(--tint)}
.subject{color:var(--ink);font-weight:600;font-size:15px;margin:12px 0 4px;overflow-wrap:anywhere}
.details{white-space:pre-wrap;overflow-wrap:anywhere}
.facts{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:13px}
.facts span b{color:var(--ink)}
.file{display:inline-block;border:1px dashed var(--line);border-radius:8px;padding:2px 8px;margin:8px 6px 0 0;font-size:12px}
.note{margin-top:10px;padding:8px 10px;border:1px solid var(--warnline);background:var(--warnbg);color:var(--warn);border-radius:8px;font-size:13px;overflow-wrap:anywhere}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
button{font:inherit;font-weight:600;border-radius:999px;padding:6px 14px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink)}
button.go{background:var(--accent);border-color:var(--accent);color:var(--on)}
button.no{color:var(--danger)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.5;cursor:default}
.empty{padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
body[data-standalone]{max-width:880px;margin:auto;padding:20px}
.reply-help{color:var(--muted);font-size:13px;margin-bottom:14px}
</style></head><body>
<div class="bar"><div class="head"><b>&gt;_ termnl</b><span id="title" style="flex:1"></span></div></div>
<div id="list"><div class="empty">Loading messages…</div></div>
<script>
(function(){
  var standalone = document.body.dataset.standalone === "true";
  var nextId = 1, waiting = {};
  function post(m){ if (standalone) return; m.jsonrpc = "2.0"; window.parent.postMessage(m, "*"); }
  function request(method, params, done){ var id = nextId++; waiting[id] = done || function(){}; post({ id: id, method: method, params: params }); }
  function notify(method, params){ post({ method: method, params: params || {} }); }
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function theme(ctx){ if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme; }
  function when(iso){
    var d = new Date(iso); if (isNaN(d)) return "";
    var day = d.toDateString() === new Date().toDateString() ? "Today" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return day + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function size(n){ return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  var KIND = { request: "Request", offer: "Offer", inform: "For your information" };
  var STATUS = { open: "Waiting for a reply", accepted: "Agreed", committed: "Agreed and signed by both sides", declined: "Declined", countered: "They suggested a change" };

  function say(text, row, final){
    // Ask the agent to act; the agent's own limits still apply. Only the request id is sent.
    // The local view has no route back to the agent, so there the button copies the request to paste into the chat.
    var said = row.parentNode.querySelector(".said") || row.parentNode.appendChild(el("div", "said"));
    said.setAttribute("role", "status");
    if (!standalone) {
      if (final) Array.prototype.forEach.call(row.querySelectorAll("button"), function(b){ b.disabled = true; });
      request("ui/message", { role: "user", content: [{ type: "text", text: text }] });
      said.textContent = "Sent to the chat.";
      return;
    }
    var manual = function(){ said.textContent = "Type this in the chat: " + text; };
    if (!navigator.clipboard) return manual();
    navigator.clipboard.writeText(text).then(function(){ said.textContent = "Copied. Paste it into the chat to continue."; }, manual);
  }

  function card(item, sent){
    var u = item.untrusted_text || {}, party = sent ? item.to : item.from;
    var name = (party && party.untrusted_text && party.untrusted_text.declared_name) || "Unknown contact";
    var box = el("div", "msg"), top = el("button", "top"), who = el("div", "who"), more = el("div", "more");
    var isNew = !sent && item.status === "open";
    if (isNew) box.classList.add("new");
    top.type = "button"; top.setAttribute("aria-expanded", "false");
    top.onclick = function(){ top.setAttribute("aria-expanded", String(box.classList.toggle("open"))); };
    top.appendChild(el("div", "av", name.trim().charAt(0).toUpperCase() || "?"));
    who.appendChild(el("div", "name", (sent ? "To " : "") + name));
    who.appendChild(el("div", "when", when(sent ? item.sent : item.received)));
    top.appendChild(who);
    top.appendChild(el("span", "chip", sent ? (STATUS[item.status] || String(item.status).replace(/_/g, " ")) : (KIND[item.kind] || item.kind)));
    top.appendChild(el("span", "chev", "›"));
    box.appendChild(top);
    box.appendChild(el("div", "subject", sent ? item.subject : u.subject));
    if (u.details) box.appendChild(el("div", "details", u.details));
    box.appendChild(more);
    if (sent && u.note) more.appendChild(el("div", "note", "Their note: " + u.note));
    var facts = el("div", "facts");
    if (item.value && item.value.amount != null) { var a = el("span", "", "Amount "); a.appendChild(el("b", "", item.value.currency + " " + Number(item.value.amount).toLocaleString())); facts.appendChild(a); }
    if (u.due) { var d = el("span", "", "Due "); d.appendChild(el("b", "", u.due)); facts.appendChild(d); }
    if (facts.childNodes.length) more.appendChild(facts);
    var re = item.in_reply_to && item.in_reply_to.untrusted_text && item.in_reply_to.untrusted_text.subject;
    if (re) more.appendChild(el("div", "said", "In reply to: " + re));
    var team = sent ? item.team : item.untrusted_team_name;
    if (team) more.appendChild(el("div", "said", (sent ? "Sent to your team: " : "Sent to their team: ") + team));
    var rc = item.receipt;
    if (rc && (rc.delivered || rc.shown_to_them)) {
      var line = rc.shown_to_them ? "Shown to them " + when(rc.shown_to_them) : "Delivered " + when(rc.delivered);
      var theirs = rc.untrusted_text && rc.untrusted_text.their_status;
      more.appendChild(el("div", "said", line + (theirs ? " · Their status: " + theirs : "")));
    }
    var also = item.also_sent_to;
    if (also && also.length) {
      var names = also.map(function(c){ return (c.untrusted_text && c.untrusted_text.declared_name) || "Unknown contact"; });
      more.appendChild(el("div", "said", "Also sent to: " + names.join(", ")));
    }
    (u.attachments || []).forEach(function(f){ more.appendChild(el("span", "file", "📎 " + f.name + " · " + size(f.bytes))); });
    var owner = String(item.authority).indexOf("needs_owner") === 0;
    if (isNew && owner) more.appendChild(el("div", "note", "Outside your agent's limits. Only you can approve it, in a terminal: termnl approve " + item.id));
    var acts = el("div", "acts");
    function btn(label, cls, verb, final){ var b = el("button", cls, label); b.type = "button"; b.onclick = function(){ say(verb + " Termnl request " + item.id, acts, final); }; acts.appendChild(b); }
    if (isNew && !owner) btn(item.kind === "inform" ? "Acknowledge" : "Accept", "go", "Accept", true);
    if (isNew) btn("Decline", "no", "Decline", true);
    if (isNew) btn("Suggest a change", "", "I want to suggest a change to");
    btn(sent ? "Follow up" : "Reply", isNew ? "" : "go", sent ? "I want to send a follow-up to" : "I want to reply to");
    btn("Forward", "", "I want to forward");
    if (!sent && (u.attachments || []).length) btn("Save files", "", "Save the attachments from");
    more.appendChild(acts);
    return box;
  }

  function render(result){
    var list = document.getElementById("list"), data;
    try { data = JSON.parse(result.content[0].text); } catch (e) { data = null; }
    list.textContent = "";
    if (!data || result.isError) { list.appendChild(el("div", "empty", "Could not load messages.")); return; }
    var sent = Array.isArray(data.sent), items = (sent ? data.sent : data.requests) || [];
    document.getElementById("title").textContent = items.length + (sent ? " sent for you" : " for you");
    if (!items.length) list.appendChild(el("div", "empty", sent ? "Nothing sent yet." : "Nothing waiting for you."));
    items.slice().reverse().forEach(function(i){ list.appendChild(card(i, sent)); });
    // Open the newest message that still needs an answer, or the only one, so there is something to read at once.
    var first = list.querySelector(".msg.new .top") || (items.length === 1 && list.querySelector(".top"));
    if (first) first.click();
  }

  var compose = el("button", "", "New message"); compose.type = "button";
  compose.style.textTransform = "none"; compose.style.letterSpacing = "0"; compose.style.fontSize = "13px";
  compose.onclick = function(){ say("I want to send a new Termnl message", compose.parentNode); };
  document.querySelector(".head").appendChild(compose);

  window.addEventListener("message", function(ev){
    var m = ev.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && !m.method) { var done = waiting[m.id]; delete waiting[m.id]; if (done) done(m.result || {}); return; }
    if (m.method === "ui/notifications/tool-result") render(m.params);
    else if (m.method === "ui/notifications/host-context-changed") theme(m.params);
    else if (m.id != null) post({ id: m.id, result: {} });
  });
  if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
  if (standalone) {
    var help = el("div", "reply-help", "Private local view · Refresh after checking messages in Codex. Buttons copy a request to paste into the chat.");
    document.getElementById("list").before(help);
    render(JSON.parse(document.getElementById("snapshot").textContent));
    return;
  }
  new ResizeObserver(function(){ notify("ui/notifications/size-changed", { height: document.documentElement.scrollHeight }); }).observe(document.body);
  request("ui/initialize", { appInfo: { name: "termnl", version: "1" }, appCapabilities: {}, protocolVersion: "2026-01-26" }, function(r){
    theme(r.hostContext);
    notify("ui/notifications/initialized");
  });
})();
</script></body></html>`;
