import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VIEW_PASSCODE } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "files";

let folders = [];
let files = [];
let qrItems = [];
let session = null;

const TYPE_META = {
  doc:{bg:"#2B579A",label:"W"}, docx:{bg:"#2B579A",label:"W"},
  xls:{bg:"#1D6F42",label:"X"}, xlsx:{bg:"#1D6F42",label:"X"},
  ppt:{bg:"#D24726",label:"P"}, pptx:{bg:"#D24726",label:"P"},
  pdf:{bg:"#B3261E",label:"PDF"},
  png:{bg:"#7C4DFF",label:"IMG"}, jpg:{bg:"#7C4DFF",label:"IMG"}, jpeg:{bg:"#7C4DFF",label:"IMG"},
  gif:{bg:"#7C4DFF",label:"IMG"}, webp:{bg:"#7C4DFF",label:"IMG"}, svg:{bg:"#7C4DFF",label:"IMG"},
  drawio:{bg:"#F08705",label:"⬡"},
  txt:{bg:"#546E7A",label:"TXT"}, md:{bg:"#546E7A",label:"MD"}
};
function typeMeta(ext){ return TYPE_META[ext] || {bg:"#8A8578",label:(ext||"?").slice(0,3).toUpperCase()}; }
function extOf(name){ const m=/\.([a-z0-9]+)$/i.exec(name||""); return m ? m[1].toLowerCase() : ""; }
function mimeFor(ext){
  const map={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",
    pdf:"application/pdf",
    doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:"application/vnd.ms-excel", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:"application/vnd.ms-powerpoint", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    drawio:"application/xml", txt:"text/plain", md:"text/markdown"};
  return map[ext] || "application/octet-stream";
}
function fmtSize(b){
  if(b==null) return "—";
  if(b<1024) return b+" B";
  if(b<1024*1024) return (b/1024).toFixed(1)+" KB";
  return (b/1024/1024).toFixed(1)+" MB";
}
function fmtDate(iso){
  try{ return new Date(iso).toLocaleDateString("mn-MN",{year:"numeric",month:"short",day:"numeric"}); }
  catch(e){ return iso || ""; }
}
function uid(){ return crypto.randomUUID(); }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function publicUrlFor(path){ return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }

/* ---------------- toast ---------------- */
function showToast(msg, isError){
  let t = document.getElementById("toast");
  if(!t){ t = document.createElement("div"); t.id="toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = "toast" + (isError ? " toast-error" : "");
  t.style.display = "block";
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.style.display="none"; }, 8000);
}

/* ---------------- data ---------------- */
async function loadData(){
  const [{ data: f1, error: e1 }, { data: f2, error: e2 }] = await Promise.all([
    supabase.from("folders").select("*").order("created_at", { ascending:true }),
    supabase.from("files").select("*").order("added_at", { ascending:false }),
  ]);
  if(e1) { showToast("Фолдер ачаалахад алдаа: " + e1.message, true); return; }
  if(e2) { showToast("Файл ачаалахад алдаа: " + e2.message, true); return; }
  folders = f1 || [];
  files = f2 || [];
  render();
}
async function loadQrItems(){
  const { data, error } = await supabase.from("qr_items").select("*").order("name", { ascending:true });
  if(error){ showToast("QR ачаалахад алдаа: " + error.message, true); return; }
  qrItems = data || [];
  render();
}
function folderById(id){ return folders.find(x=>x.id===id); }
function childFolders(id){ return folders.filter(x=>x.parent_id===id); }
function filesIn(id){ return files.filter(x=>x.folder_id===id); }
function fileById(id){ return files.find(x=>x.id===id); }
function qrItemById(id){ return qrItems.find(x=>x.id===id); }
function breadcrumbChain(id){
  const chain=[]; let cur=folderById(id);
  while(cur){ chain.unshift(cur); cur = cur.parent_id ? folderById(cur.parent_id) : null; }
  return chain;
}
function topFolders(){ return childFolders("root"); }

/* ---------------- boot ---------------- */
async function boot(){
  const { data: { session: s } } = await supabase.auth.getSession();
  session = s;
  supabase.auth.onAuthStateChange((_evt, s2)=>{ session = s2; updateAdminUI(); });

  wireStaticEvents();

  if(localStorage.getItem("iso184_unlocked") === "1") showApp();

  await Promise.all([loadData(), loadQrItems()]);
  updateAdminUI();

  supabase
    .channel("public:drive-changes")
    .on("postgres_changes", { event:"*", schema:"public", table:"files" }, loadData)
    .on("postgres_changes", { event:"*", schema:"public", table:"folders" }, loadData)
    .on("postgres_changes", { event:"*", schema:"public", table:"qr_items" }, loadQrItems)
    .subscribe();

  window.addEventListener("hashchange", render);
}

function tryUnlock(){
  const v = document.getElementById("gate-input").value.trim();
  if(v && v === VIEW_PASSCODE){
    localStorage.setItem("iso184_unlocked", "1");
    showApp();
  } else {
    document.getElementById("gate-err").textContent = "Код буруу байна. Дахин оролдоно уу.";
  }
}
function showApp(){
  document.getElementById("gate").style.display = "none";
  document.getElementById("app").classList.add("show");
  if(!location.hash) location.hash = "#f=root";
  renderSidebar();
  render();
}

/* ---------------- admin auth ---------------- */
function updateAdminUI(){
  const statusEl = document.getElementById("admin-status");
  const btn = document.getElementById("admin-btn");
  if(session){
    statusEl.textContent = "Админ: " + session.user.email;
    btn.textContent = "Гарах";
  } else {
    statusEl.textContent = "Зочин горим";
    btn.textContent = "Админ нэвтрэх";
  }
  render();
}
async function adminLogin(){
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;
  const statusEl = document.getElementById("admin-login-status");
  statusEl.textContent = "Нэвтэрч байна…";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if(error){ statusEl.textContent = "Алдаа: " + error.message; return; }
  statusEl.textContent = "";
  closeModal("modal-admin");
}

/* ---------------- routing helpers ---------------- */
function isQrRoute(){ return location.hash === "#qr"; }
function currentFolderId(){
  const m = /f=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : "root";
}
function currentFileId(){
  const m = /file=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------------- rendering ---------------- */
function renderSidebar(){
  document.getElementById("side-folders").innerHTML = topFolders().map(f=>
    `<a href="#f=${encodeURIComponent(f.id)}" class="side-link" data-nav="${f.id}">📂 ${escapeHtml(f.name)}</a>`
  ).join("");
}

function render(){
  if(!document.getElementById("app").classList.contains("show")) return;

  const qrRoute = isQrRoute();
  document.getElementById("folder-view").hidden = qrRoute;
  document.getElementById("qr-view").hidden = !qrRoute;

  renderSidebar();

  if(qrRoute){
    document.querySelectorAll(".side-link").forEach(a=>a.classList.toggle("active", a.dataset.nav==="qr"));
    document.getElementById("viewer").classList.remove("show");
    renderQrGrid();
    return;
  }

  const fileId = currentFileId();
  const viewerEl = document.getElementById("viewer");
  if(fileId){ openViewer(fileId); viewerEl.classList.add("show"); }
  else { viewerEl.classList.remove("show"); }

  const folderId = currentFolderId();
  const folder = folderById(folderId) || folderById("root");
  if(!folder) return;

  document.querySelectorAll(".side-link").forEach(a=>a.classList.toggle("active", a.dataset.nav===folder.id));

  const chain = breadcrumbChain(folder.id);
  document.getElementById("crumbs").innerHTML = chain.map((f,i)=>{
    const label = f.id==="root" ? "Нүүр" : escapeHtml(f.name);
    const isLast = i===chain.length-1;
    return (i>0?'<span class="sep">/</span>':'') + (isLast ? `<span>${label}</span>` : `<a href="#f=${encodeURIComponent(f.id)}">${label}</a>`);
  }).join("");

  const q = (document.getElementById("search-input").value || "").toLowerCase();
  let subFolders = childFolders(folder.id);
  let subFiles = filesIn(folder.id);
  if(q){
    subFolders = subFolders.filter(f=>f.name.toLowerCase().includes(q));
    subFiles = subFiles.filter(f=>f.name.toLowerCase().includes(q));
  }

  const listing = document.getElementById("listing");
  const isAdmin = !!session;
  document.getElementById("admin-actions").hidden = !isAdmin;

  if(subFolders.length===0 && subFiles.length===0){
    listing.innerHTML = `<div class="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
      <div>Энд файл, фолдер алга байна.</div>
    </div>`;
    return;
  }

  let rows = "";
  subFolders.forEach(f=>{
    rows += `<tr>
      <td colspan="3">
        <div class="row-name" data-open-folder="${f.id}">
          <div class="badge" style="background:var(--folder-soft);color:var(--folder);font-size:16px;">📁</div>
          <span class="label">${escapeHtml(f.name)}</span>
        </div>
      </td>
      <td></td>
      <td></td>
    </tr>`;
  });
  subFiles.forEach(f=>{
    const meta = typeMeta(f.ext);
    rows += `<tr>
      <td colspan="2">
        <div class="row-name" data-open-file="${f.id}">
          <div class="badge" style="background:${meta.bg}">${meta.label}</div>
          <span class="label">${escapeHtml(f.name)}</span>
        </div>
      </td>
      <td class="dim mono">${fmtDate(f.added_at)}</td>
      <td class="dim mono">${fmtSize(f.size)}</td>
      <td>
        ${isAdmin ? `<div class="row-actions">
          <button class="icon-btn" title="Нэр солих" data-rename="${f.id}">✎</button>
          <button class="icon-btn danger" title="Устгах" data-delete="${f.id}">✕</button>
        </div>` : ``}
      </td>
    </tr>`;
  });

  listing.innerHTML = `<table><thead><tr>
    <th colspan="2">Нэр</th><th>Огноо</th><th>Хэмжээ</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  listing.querySelectorAll("[data-open-folder]").forEach(el=>
    el.addEventListener("click", ()=>{ location.hash = "f=" + encodeURIComponent(el.dataset.openFolder); }));
  listing.querySelectorAll("[data-open-file]").forEach(el=>
    el.addEventListener("click", ()=>{ location.hash = "file=" + encodeURIComponent(el.dataset.openFile); }));
  listing.querySelectorAll("[data-rename]").forEach(el=>
    el.addEventListener("click", (e)=>{ e.stopPropagation(); openRename("file", el.dataset.rename); }));
  listing.querySelectorAll("[data-delete]").forEach(el=>
    el.addEventListener("click", (e)=>{ e.stopPropagation(); deleteFile(el.dataset.delete); }));
}

function renderQrGrid(){
  const isAdmin = !!session;
  document.getElementById("qr-admin-actions").hidden = !isAdmin;
  const grid = document.getElementById("qr-grid");
  if(qrItems.length===0){
    grid.innerHTML = `<div class="empty">QR код алга байна.</div>`;
    return;
  }
  grid.innerHTML = qrItems.map(item=>{
    const imgUrl = publicUrlFor(item.storage_path);
    return `<div class="qr-card">
      ${isAdmin ? `<div class="qr-actions">
        <button class="icon-btn" title="Нэр солих" data-qr-rename="${item.id}">✎</button>
        <button class="icon-btn danger" title="Устгах" data-qr-delete="${item.id}">✕</button>
      </div>` : ``}
      <img src="${imgUrl}" alt="${escapeHtml(item.name)}" />
      <div class="qr-name">${escapeHtml(item.name)}</div>
    </div>`;
  }).join("");
  grid.querySelectorAll("[data-qr-rename]").forEach(el=>
    el.addEventListener("click", ()=> openRename("qr", el.dataset.qrRename)));
  grid.querySelectorAll("[data-qr-delete]").forEach(el=>
    el.addEventListener("click", ()=> deleteQrItem(el.dataset.qrDelete)));
}

/* ---------------- modals ---------------- */
function openModal(id){ document.getElementById(id).classList.add("show"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

/* ---------------- folder create ---------------- */
async function createFolder(){
  const input = document.getElementById("new-folder-name");
  const name = input.value.trim();
  if(!name) return;
  const { error } = await supabase.from("folders").insert({ id: uid(), name, parent_id: currentFolderId() });
  if(error){ showToast("Фолдер үүсгэхэд алдаа: " + error.message, true); return; }
  input.value = "";
  closeModal("modal-folder");
}

/* ---------------- upload ---------------- */
async function doUpload(){
  const input = document.getElementById("file-input");
  const status = document.getElementById("upload-status");
  const selected = Array.from(input.files || []);
  if(selected.length===0) return;
  const btn = document.getElementById("upload-go");
  btn.disabled = true;
  const folderId = currentFolderId();

  for(let i=0;i<selected.length;i++){
    const f = selected[i];
    status.textContent = `(${i+1}/${selected.length}) ${f.name} хуулж байна…`;
    const id = uid();
    const ext = extOf(f.name);
    const path = `${id}.${ext || "bin"}`;
    const mime = f.type || mimeFor(ext);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: mime, upsert: false });
    if(upErr){
      status.textContent = `Алдаа (${f.name}): ${upErr.message}`;
      btn.disabled = false;
      return;
    }
    const { error: dbErr } = await supabase.from("files").insert({
      id, name: f.name, folder_id: folderId, ext, mime, storage_path: path, size: f.size,
    });
    if(dbErr){
      await supabase.storage.from(BUCKET).remove([path]);
      status.textContent = `Алдаа (${f.name}): ${dbErr.message}`;
      btn.disabled = false;
      return;
    }
  }
  status.textContent = "";
  btn.disabled = false;
  input.value = "";
  closeModal("modal-upload");
}

/* ---------------- rename (shared: file or qr item) / delete ---------------- */
let renameTarget = null; // { type: "file" | "qr", id }
function openRename(type, id){
  renameTarget = { type, id };
  const item = type === "qr" ? qrItemById(id) : fileById(id);
  if(!item) return;
  document.getElementById("rename-input").value = item.name;
  openModal("modal-rename");
}
async function doRename(){
  const val = document.getElementById("rename-input").value.trim();
  if(!val || !renameTarget) return closeModal("modal-rename");
  const table = renameTarget.type === "qr" ? "qr_items" : "files";
  const { error } = await supabase.from(table).update({ name: val }).eq("id", renameTarget.id);
  if(error){ showToast("Нэр солиход алдаа: " + error.message, true); return; }
  closeModal("modal-rename");
}
async function deleteFile(id){
  const f = fileById(id);
  if(!f) return;
  if(!confirm(`"${f.name}" файлыг устгах уу?`)) return;
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([f.storage_path]);
  if(rmErr){ showToast("Устгахад алдаа: " + rmErr.message, true); return; }
  const { error: dbErr } = await supabase.from("files").delete().eq("id", f.id);
  if(dbErr){ showToast("Устгахад алдаа: " + dbErr.message, true); return; }
}

/* ---------------- QR board ---------------- */
async function doAddQrItem(){
  const nameInput = document.getElementById("qr-item-name");
  const fileInput = document.getElementById("qr-item-file");
  const status = document.getElementById("qr-add-status");
  const name = nameInput.value.trim();
  const file = fileInput.files[0];
  if(!name || !file){ status.textContent = "Нэр болон зураг хоёуланг нь оруулна уу."; return; }
  const id = uid();
  const ext = extOf(file.name) || "png";
  const path = `qr/${id}.${ext}`;
  status.textContent = "Хуулж байна…";
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "image/png" });
  if(upErr){ status.textContent = "Алдаа: " + upErr.message; return; }
  const { error: dbErr } = await supabase.from("qr_items").insert({ id, name, storage_path: path });
  if(dbErr){
    await supabase.storage.from(BUCKET).remove([path]);
    status.textContent = "Алдаа: " + dbErr.message;
    return;
  }
  status.textContent = "";
  nameInput.value = "";
  fileInput.value = "";
  closeModal("modal-qr-add");
}
async function deleteQrItem(id){
  const item = qrItemById(id);
  if(!item) return;
  if(!confirm(`"${item.name}" QR-г устгах уу?`)) return;
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([item.storage_path]);
  if(rmErr){ showToast("Устгахад алдаа: " + rmErr.message, true); return; }
  const { error: dbErr } = await supabase.from("qr_items").delete().eq("id", id);
  if(dbErr){ showToast("Устгахад алдаа: " + dbErr.message, true); return; }
}

/* ---------------- file viewer ---------------- */
function closeViewer(){
  const f = fileById(currentFileId());
  location.hash = "f=" + encodeURIComponent(f ? f.folder_id : "root");
}

async function openViewer(fileId){
  const f = fileById(fileId);
  const body = document.getElementById("viewer-body");
  const meta = typeMeta(f ? f.ext : "");
  document.getElementById("viewer-badge").innerHTML = `<span class="badge" style="background:${meta.bg}">${meta.label}</span>`;
  document.getElementById("viewer-name").textContent = f ? f.name : "Файл олдсонгүй";
  body.innerHTML = `<div class="center-card">Ачааллаж байна…</div>`;
  if(!f){ body.innerHTML = `<div class="center-card">Энэ файл олдсонгүй. Устгагдсан байж магадгүй.</div>`; return; }

  const url = publicUrlFor(f.storage_path);
  try{
    if(["png","jpg","jpeg","gif","webp","svg"].includes(f.ext)){
      body.innerHTML = `<img class="preview" src="${url}" alt="${escapeHtml(f.name)}" />`;
      return;
    }
    if(f.ext==="pdf"){
      body.innerHTML = `<embed class="pdf-frame" src="${url}" type="application/pdf" />`;
      return;
    }
    if(["docx","doc","xlsx","xls","pptx","ppt"].includes(f.ext)){
      const officeUrl = "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(url);
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;">
        <iframe class="office-frame" src="${officeUrl}" frameborder="0"></iframe>
        <p class="hint">Дэлгэц дээр гарахгүй бол <a href="${url}" target="_blank" rel="noopener">шинэ tab-аар нээх</a>.</p>
      </div>`;
      return;
    }
    if(f.ext==="drawio"){
      const openUrl = "https://app.diagrams.net/#U" + encodeURIComponent(url);
      body.innerHTML = `<div class="center-card">
        <div class="badge" style="background:${meta.bg}">${meta.label}</div>
        <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(f.name)}</div>
        <p class="hint" style="margin-bottom:18px;">draw.io диаграм. Шинэ tab дээр diagrams.net ашиглан нээнэ.</p>
        <a class="btn-primary" style="justify-content:center;text-decoration:none;" target="_blank" rel="noopener" href="${openUrl}">Diagrams.net дээр нээх ↗</a>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="center-card">
      <div class="badge" style="background:${meta.bg}">${meta.label}</div>
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(f.name)}</div>
      <p class="hint" style="margin-bottom:18px;">Энэ төрлийг сайт дээр урьдчилан харах дэмжлэггүй.</p>
      <a class="btn-ghost" style="text-decoration:none;" target="_blank" rel="noopener" href="${url}">Шинэ tab-аар нээх ↗</a>
    </div>`;
  }catch(err){
    body.innerHTML = `<div class="center-card">
      <div style="font-weight:700;margin-bottom:6px;color:var(--danger);">Нээхэд алдаа гарлаа</div>
      <p class="hint">${escapeHtml(String((err && err.message) || err))}</p>
    </div>`;
  }
}

/* ---------------- static event wiring ---------------- */
function wireStaticEvents(){
  document.getElementById("gate-btn").addEventListener("click", tryUnlock);
  document.getElementById("gate-input").addEventListener("keydown", e=>{ if(e.key==="Enter") tryUnlock(); });

  document.getElementById("search-input").addEventListener("input", render);

  document.getElementById("admin-btn").addEventListener("click", async ()=>{
    if(session){ await supabase.auth.signOut(); }
    else { openModal("modal-admin"); }
  });
  document.getElementById("admin-login-go").addEventListener("click", adminLogin);

  document.getElementById("new-folder-btn").addEventListener("click", ()=>{
    document.getElementById("new-folder-name").value = "";
    openModal("modal-folder");
  });
  document.getElementById("create-folder-go").addEventListener("click", createFolder);

  document.getElementById("upload-btn").addEventListener("click", ()=>{
    document.getElementById("file-input").value = "";
    document.getElementById("upload-status").textContent = "";
    openModal("modal-upload");
  });
  document.getElementById("upload-go").addEventListener("click", doUpload);

  document.getElementById("qr-add-btn").addEventListener("click", ()=>{
    document.getElementById("qr-item-name").value = "";
    document.getElementById("qr-item-file").value = "";
    document.getElementById("qr-add-status").textContent = "";
    openModal("modal-qr-add");
  });
  document.getElementById("qr-add-go").addEventListener("click", doAddQrItem);

  document.getElementById("rename-go").addEventListener("click", doRename);
  document.getElementById("viewer-close-btn").addEventListener("click", closeViewer);

  document.querySelectorAll("[data-close]").forEach(el=>
    el.addEventListener("click", ()=> closeModal(el.dataset.close)));
}

boot();
