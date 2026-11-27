// Аппын service worker. Файлыг хадгалж (cache) үлдээхгүй тул сайт шинэчлэгдэхэд апп шууд шинэ хувилбараа авна.
// Интернэтгүй үед зөвхөн «Интернэт холболтоо шалгана уу» гэсэн хуудас харуулна.
const OFFLINE = `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>184 Сургууль</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEF7EE;color:#213024;font:600 17px system-ui,sans-serif;text-align:center;padding:24px}
b{display:block;font-size:22px;margin-bottom:8px;color:#1E7A3B}button{margin-top:18px;padding:12px 22px;border:0;border-radius:12px;background:#1E7A3B;color:#fff;font:inherit}</style></head>
<body><div><b>Интернэт холболт алга</b>Холболтоо шалгаад дахин оролдоно уу.<br><button onclick="location.reload()">Дахин ачаалах</button></div></body></html>`;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
