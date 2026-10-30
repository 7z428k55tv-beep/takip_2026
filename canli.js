function apiTaban() {
  const h = location.hostname;
  if (h === "" || h === "localhost" || h === "127.0.0.1") return "";
  return "";
}
async function canliAramaYap() {
  const q = $("inCanli").value.trim();
  if (q.length < 2) return toast("Aramak icin en az 2 harf yaz");
  $("canliDurum").textContent = "Magazalarda + marka resmi sitesinde araniyor (Trendyol, Amazon, N11, Vatan, MediaMarkt, PTTAVM, Pazarama, Apple/Huawei/Samsung/Xiaomi)...";
  $("canliListe").innerHTML = "";
  $("btnCanli").disabled = true;
  try {
    const r = await fetch("/api/ara?q=" + encodeURIComponent(q));
    const d = await r.json();
    if (!r.ok) { $("canliDurum").textContent = d.hata || "Arama hatasi"; return; }
    if (!d.urunler || !d.urunler.length) {
      const oz = d.magazalar ? Object.keys(d.magazalar).map((k) => k + ":" + d.magazalar[k].durum).join(" ") : "?";
      $("canliDurum").textContent = "Sonuc bulunamadi (" + oz + ")";
      return;
    }
    const tum = d.urunler;
    const resmi = tum.filter((it) => /store$/i.test(it.magaza || ""));
    const rest = tum.filter((it) => resmi.indexOf(it) < 0);
    /* istek 1: magazaya gore blokla — her magazanin urunleri yanyana */
    const blok = {};
    for (const it of rest) {
      const k = it.magaza || "Diger";
      (blok[k] = blok[k] || []).push(it);
    }
    for (const k of Object.keys(blok)) blok[k].sort((a, b) => a.fiyat - b.fiyat);
    $("canliDurum").textContent = tum.length + " urun (magaza bloklari + resmi site)" + (d.hamAdet > tum.length ? " — " + d.hamAdet + " sonuc icinden secildi" : "") + " — resmi site en ustte";
    canliSonuclar = tum;
    const kart = (it) =>
      "<div class='live-item'>" +
      (it.resim ? "<img src='" + esc(it.resim) + "' loading='lazy' alt=''>" : "") +
      "<div class='li-body'><div class='li-ad' title='" + esc(it.baslik) + "'>" + esc(it.baslik) + "</div>" +
      "<div class='li-fiyat'>" + tl(it.fiyat) + " <small style='font-weight:400;color:#6b7686'>" + esc(it.magaza || "") + "</small></div>" +
      "<div class='li-btns'><button data-canli='" + it.id + "'>Takibe Al</button>" +
      "<a href='" + esc(it.link) + "' target='_blank' style='font-size:11px;align-self:center'>Magazada ac</a></div></div></div>";
    let html = "";
    for (const it of resmi) html += kart(it);
    for (const k of Object.keys(blok).sort()) {
      html += "<div style='grid-column:1/-1;font-size:13px;font-weight:800;color:#4f46e5;margin-top:6px'>🏬 " + esc(k) + "</div>";
      for (const it of blok[k]) html += kart(it);
    }
    $("canliListe").innerHTML = html;
  } catch (e) {
    $("canliDurum").textContent = "Sunucuya erisilemiyor — sayfayi 'node server/server.js' ile acin (http://localhost:8099)";
  } finally { $("btnCanli").disabled = false; }
}
let canliSonuclar = [];
async function canliTakibeAl(id) {
  const it = (canliSonuclar || []).find((x) => x.id === id);
  if (!it) return;
  try {
    const r = await fetch("/api/takip", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baslik: it.baslik, fiyat: it.fiyat, link: it.link, resim: it.resim, magaza: it.magaza, arama: $("inCanli").value.trim() }) });
    if (!r.ok) { toast("Kaydedilemedi"); return; }
    toast("Takibe alindi: " + it.baslik.slice(0, 40));
    if (typeof yukleTakipler === "function") await yukleTakipler();
    else sonTakipleriYukle();
  } catch (e) { toast("Sunucuya erisilemiyor"); }
}
async function sonTakipleriYukle() {
  try {
    const r = await fetch("/api/takipler");
    if (!r.ok) return;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length) {
      const ind = arr.filter((t) => t.sonFiyat < t.referansFiyat);
      if (ind.length) {
        const t = ind[0];
        toast("Indirim var: " + t.baslik.slice(0, 40) + " -> " + tl(t.sonFiyat));
        masaustuBildirim("Indirim Takip", t.baslik + " " + tl(t.referansFiyat) + " -> " + tl(t.sonFiyat));
      }
    }
  } catch (e) { /* sunucu yoksa sessiz */ }
}
const _cizSon = ciz;
ciz = function () { _cizSon(); sonTakipleriYukle(); };
document.addEventListener("DOMContentLoaded", () => {
  const b = $("btnCanli");
  if (b) b.addEventListener("click", canliAramaYap);
  const ic = $("inCanli");
  if (ic) ic.addEventListener("keydown", (e) => { if (e.key === "Enter") canliAramaYap(); });
  const cl = $("canliListe");
  if (cl) cl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-canli]");
    if (btn) canliTakibeAl(btn.dataset.canli);
  });
  sonTakipleriYukle();
  setInterval(sonTakipleriYukle, 60000);
});