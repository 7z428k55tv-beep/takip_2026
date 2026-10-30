"use strict";
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function tl(n) { try { return Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 }); } catch (e) { return String(n); } }
function toast(m) {
  const t = $("toast"); if (!t) return;
  t.textContent = m; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("show"); }, 2500);
}
function masaustuBildirim(baslik, metin) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") { try { new Notification(baslik, { body: metin }); } catch (e) {} }
}
let takipler = [];
async function yukleTakipler() {
  try {
    const r = await fetch("/api/takipler");
    if (r.ok) takipler = await r.json();
  } catch (e) {}
  ciz();
}
function ciz() {
  const listeEl = $("liste"); if (!listeEl) return;
  let arr = takipler.slice();
  const q = (($("inAra") && $("inAra").value) || "").toLowerCase().trim();
  if (q) arr = arr.filter(function (t) { return String(t.baslik || "").toLowerCase().indexOf(q) >= 0; });
  const f = $("selFiltre") ? $("selFiltre").value : "tumu";
  if (f === "indirimde") arr = arr.filter(function (t) { return t.sonFiyat < t.referansFiyat; });
  const s = $("selSira") ? $("selSira").value : "yeni";
  if (s === "indirim") arr.sort(function (a, b) { return (b.referansFiyat - b.sonFiyat) - (a.referansFiyat - a.sonFiyat); });
  else if (s === "fiyatArtan") arr.sort(function (a, b) { return a.sonFiyat - b.sonFiyat; });
  else if (s === "fiyatAzalan") arr.sort(function (a, b) { return b.sonFiyat - a.sonFiyat; });
  else arr.sort(function (a, b) { return String(b.olusturma).localeCompare(String(a.olusturma)); });
  if (!arr.length) {
    listeEl.innerHTML = "";
    const bos = $("bos"); if (bos) bos.style.display = "";
    guncelleStats();
    return;
  }
  const bos = $("bos"); if (bos) bos.style.display = "none";
  listeEl.innerHTML = arr.map(function (t) {
    const ind = t.sonFiyat < t.referansFiyat;
    const yuzde = ind ? Math.round((1 - t.sonFiyat / t.referansFiyat) * 1000) / 10 : 0;
    return "<div class='urun " + (ind ? "indirimli" : "") + "'>" +
      (ind ? "<div class='rozet'>%" + yuzde + " indirim</div>" : "") +
      "<div class='u-ad'>" + esc(t.baslik) + "</div>" +
      "<div class='u-mag'>" + esc(t.magaza || "") + "</div>" +
      "<div class='u-fiyatlar'>" +
      "<div class='fk'><label>Referans</label><b>" + tl(t.referansFiyat) + " ₺</b></div>" +
      "<div class='fk son'><label>Son</label><b>" + tl(t.sonFiyat) + " ₺</b></div>" +
      "</div>" +
      (ind ? "<div class='u-kazanc'>Kazanç: " + tl(t.referansFiyat - t.sonFiyat) + " ₺</div>" : "") +
      (t.link ? "<a class='u-link' href='" + esc(t.link) + "' target='_blank'>Mağazada aç</a>" : "") +
      "<div class='u-btns'>" +
      "<button class='small' data-guncelle='" + t.id + "'>Fiyat Güncelle</button>" +
      "<button class='small danger' data-sil='" + t.id + "'>Sil</button>" +
      "</div></div>";
  }).join("");
  listeEl.querySelectorAll("button[data-sil]").forEach(function (b) {
    b.addEventListener("click", async function () {
      try { await fetch("/api/takip/" + b.dataset.sil, { method: "DELETE" }); } catch (e) {}
      await yukleTakipler();
    });
  });
  guncelleStats();
}
function guncelleStats() {
  const stT = $("stToplam"); if (stT) stT.textContent = takipler.length;
  const stI = $("stIndirim"); if (stI) stI.textContent = takipler.filter(function (t) { return t.sonFiyat < t.referansFiyat; }).length;
  const kaz = takipler.reduce(function (a, t) { const d = t.referansFiyat - t.sonFiyat; return a + (d > 0 ? d : 0); }, 0);
  const stK = $("stKazanc"); if (stK) stK.textContent = tl(kaz) + " ₺";
}
document.addEventListener("DOMContentLoaded", function () {
  const btnEkle = $("btnEkle");
  if (btnEkle) btnEkle.addEventListener("click", async function () {
    const link = (($("inLink") && $("inLink").value) || "").trim();
    if (!link) return toast("Link girin");
    toast("Cozuluyor...");
    try {
      const r = await fetch("/api/coz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: link }) });
      const d = await r.json();
      if (!r.ok) { toast(d.hata || "Cozulemedi"); return; }

      // Daha uygun alternatif var mi?
      const alt = (d.alternatifler || []).filter((a) => a.fiyat > 0 && a.fiyat < d.fiyat * 0.95);
      if (alt.length && $("dlgAlternatif")) {
        window._pendenLink = link;
        window._pendenCozum = d;
        const mesaj = $("dlgAltMesaj");
        const liste = $("dlgAltListe");
        if (mesaj) mesaj.textContent = "\"" + esc(d.baslik) + "\" icin " + alt.length + " daha uygun alternatif bulundu (fiyatsiz degil).";
        if (liste) {
          liste.innerHTML = alt.map(function (a) {
            return "<div class='alt-item'>" +
              (a.resim ? "<img src='" + esc(a.resim) + "' loading='lazy' alt=''>" : "") +
              "<div class='alt-body'>" +
              "<div class='alt-ad' title='" + esc(a.baslik) + "'>" + esc(a.baslik) + "</div>" +
              "<div class='alt-mag'>" + esc(a.magaza || "") + "</div>" +
              "</div>" +
              "<div class='alt-fiyat'>" + tl(a.fiyat) + " TL</div>" +
              "<button class='alt-sec' data-alt='" + esc(JSON.stringify({ baslik: a.baslik, fiyat: a.fiyat, link: a.link, resim: a.resim || "", magaza: a.magaza || "" })).replace(/'/g, "&#39;") + "'>Sec</button>" +
              "</div>";
          }).join("");
          liste.querySelectorAll(".alt-sec").forEach(function (b) {
            b.addEventListener("click", function () {
              const sec = JSON.parse(b.dataset.alt.replace(/&#39;/g, "'"));
              window._secilenAlternatif = sec;
              $("dlgAlternatif").close();
              kaydetTakip(sec.baslik, sec.fiyat, sec.link, sec.resim, sec.magaza);
            });
          });
        }
        $("dlgAlternatif").showModal();
        return;
      }

      kaydetTakip(d.baslik, d.fiyat, link, d.resim || "", d.magaza || "");
    } catch (e) { toast("Sunucu hatasi"); }
  });

  function kaydetTakip(baslik, fiyat, link, resim, magaza) {
    fetch("/api/takip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baslik: baslik, fiyat: fiyat, link: link, resim: resim || "", magaza: magaza || "" }) })
      .then(function (r2) {
        if (!r2.ok) { toast("Kaydedilemedi"); return; }
        toast("Takibe alindi: " + String(baslik || "").slice(0, 40));
        if ($("inLink")) $("inLink").value = "";
        return yukleTakipler();
      })
      .catch(function () { toast("Sunucu hatasi"); });
  }

  // Canli arama temizle butonu
  const btnTemizle = $("btnTemizle");
  if (btnTemizle) btnTemizle.addEventListener("click", function () {
    const ic = $("inCanli");
    if (ic) ic.value = "";
    const durum = $("canliDurum");
    if (durum) durum.textContent = "";
    const liste = $("canliListe");
    if (liste) liste.innerHTML = "";
    toast("Arama temizlendi");
  });

  // Tumunu temizle butonu
  const btnTumunuTemizle = $("btnTumunuTemizle");
  if (btnTumunuTemizle) btnTumunuTemizle.addEventListener("click", async function () {
    if (!confirm("Tum takiplenen urunler silinecek. Emin misiniz?")) return;
    try {
      const arr = await fetch("/api/takipler").then(function (r) { return r.json(); });
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        await fetch("/api/takip/" + t.id, { method: "DELETE" });
      }
      toast("Tum takipler temizlendi (" + arr.length + ")");
      await yukleTakipler();
    } catch (e) { toast("Silme hatasi"); }
  });
  ["inAra", "selSira", "selFiltre"].forEach(function (id) {
    const el = $(id); if (el) { el.addEventListener("input", ciz); el.addEventListener("change", ciz); }
  });
  const btnBildirim = $("btnBildirim");
  if (btnBildirim) btnBildirim.addEventListener("click", function () {
    if ("Notification" in window) Notification.requestPermission().then(function (p) { toast("Bildirim izni: " + p); });
  });
  yukleTakipler();
});