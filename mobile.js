// Утсан дээр апп шиг харагдуулна: дээд мөр + доод цэс (tab bar) + «Цэс» товчоор нээгдэх хажуугийн цэс.
(function () {
  const mq = matchMedia("(max-width:760px)");
  const TABS = [
    ["root", "#f=root", "🏠", "Нүүр"],
    ["qr", "#qr", "🔳", "Журам"],
    ["calendar", "#calendar", "📅", "Хуанли"],
    ["late", "#late", "⏰", "Хоцролт"],
    ["mood", "#mood", "💬", "Check-in"],
    ["registry", "#registry", "📋", "Бүртгэл"],
  ];
  const MAX = 4;
  let bar, top, shade;

  function build() {
    const app = document.getElementById("app");
    const aside = app && app.querySelector("aside");
    if (!aside || bar) return;
    top = document.createElement("header");
    top.className = "m-top";
    top.innerHTML = `<img src="./assets/calendar/logo-school.png" alt=""><b>184-р сургууль</b><span class="m-sub">менежментийн тогтолцоо</span>`;
    app.prepend(top);
    shade = document.createElement("div");
    shade.className = "m-shade";
    shade.onclick = close;
    document.body.appendChild(shade);
    const grab = document.createElement("div");
    grab.className = "m-grab";
    grab.innerHTML = `<span></span><button type="button" aria-label="Хаах">✕</button>`;
    grab.querySelector("button").onclick = close;
    aside.prepend(grab);
    aside.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
    bar = document.createElement("nav");
    bar.className = "m-tabs";
    bar.setAttribute("aria-label", "Үндсэн цэс");
    document.body.appendChild(bar);
    new MutationObserver(draw).observe(aside, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    new MutationObserver(draw).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(draw).observe(app, { attributes: true, attributeFilter: ["class"] });
    addEventListener("hashchange", draw);
    draw();
  }

  function visible(nav) {
    const a = document.querySelector(`aside .side-link[data-nav="${nav}"]`);
    return a && !a.hidden && getComputedStyle(a).display !== "none";
  }
  function current() {
    const h = location.hash || "#f=root";
    if (h.startsWith("#f=")) return "root";
    return h.slice(1).split(/[?&=]/)[0];
  }
  function draw() {
    if (!bar) return;
    const show = mq.matches && document.getElementById("app").classList.contains("show");
    bar.hidden = !show;
    document.body.classList.toggle("m-mode", show);
    if (!show) { close(); return; }
    const cur = current();
    const tabs = TABS.filter((t) => visible(t[0])).slice(0, MAX);
    bar.innerHTML = tabs.map(([nav, href, ic, label]) =>
      `<a href="${href}" class="${nav === cur ? "on" : ""}"><i>${ic}</i><span>${label}</span></a>`).join("") +
      `<button type="button" class="${document.body.classList.contains("m-menu") ? "on" : ""}" data-menu><i>☰</i><span>Цэс</span></button>`;
    bar.querySelector("[data-menu]").onclick = () => document.body.classList.contains("m-menu") ? close() : open();
    bar.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { close(); scrollTo(0, 0); }));
  }
  function open() { document.body.classList.add("m-menu"); draw(); }
  function close() { if (document.body.classList.contains("m-menu")) { document.body.classList.remove("m-menu"); draw(); } }

  mq.addEventListener ? mq.addEventListener("change", draw) : mq.addListener(draw);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
