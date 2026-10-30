"use strict";
/* indirim.io sunucu — sifir bagimlilik. Calistir: node server.js */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const IG = require("./indirim-gunleri");
const PORT = process.env.PORT || 8099;
const DB_FILE = path.join(__dirname, "db.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function trFiyat(s) {
  if (s == null) return null;
  let t = String(s).replace(/TL|₺|–/gi, "").trim();
  const m = t.match(/[\d.]+,\d{1,2}|\d[\d\s.]*\d|\d+/);
  if (!m) return null;
  let n = m[0].replace(/\s/g, "");
  if (n.indexOf(",") >= 0) n = n.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, "");
  const v = parseFloat(n);
  return isFinite(v) && v > 0 ? v : null;
}
function temiz(s) {
  return String(s == null ? "" : s).replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
function fetchHtml(url, extraHeaders) {
  return new Promise((resolve) => {
    if (!url || !/^https?:\/\//i.test(url)) return resolve({ status: 0, body: "", err: "gecersiz-url" });
    const args = [
      "-sL", "--max-time", "12", "--compressed",
      "-c", "\"" + process.env.TEMP + "\\cjar.txt" + "\"", "-b", "\"" + process.env.TEMP + "\\cjar.txt" + "\"",
      "-A", UA,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "-H", "Accept-Language: tr-TR,tr;q=0.9,en-US;q=0.8",
      "-H", "Upgrade-Insecure-Requests: 1",
      "-H", "Sec-Fetch-Dest: document", "-H", "Sec-Fetch-Mode: navigate", "-H", "Sec-Fetch-Site: none", "-H", "Sec-Fetch-User: ?1",
      "-H", 'sec-ch-ua: "Chromium";v="120", "Not=A?Brand";v="8"', "-H", "sec-ch-ua-mobile: ?0", "-H", 'sec-ch-ua-platform: "Windows"',
      "-w", "\n__STATUS__%{http_code}",
      url
    ];
    if (extraHeaders) {
      for (const h of extraHeaders) args.push("-H", h);
    }
    execFile("curl.exe", args, { maxBuffer: 96 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const idx = stdout.lastIndexOf("\n__STATUS__");
      let body = stdout, status = 0;
      if (idx >= 0) {
        status = parseInt(stdout.slice(idx + 12).trim(), 10) || 0;
        body = stdout.slice(0, idx);
      }
      if ((err && !status) || (!status && !body)) {
        return resolve({ status: 0, body: "", err: (stderr || (err && err.message) || "curl-hata").replace(/\s+/g, " ").slice(0, 120) });
      }
      resolve({ status: status, body: body });
    });
  });
}
/* Engelli siteler (Hepsiburada vb.) icin jina.ai proxy: hedefi render edip Markdown dondurur.
   r.jina.ai IP'yi maskeler, Akamai/WAF engelini asar. Ucretsiz; agir kullanimda hiz siniri olabilir. */
const JINA_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
function sleepMs(ms) { return new Promise((ok) => setTimeout(ok, ms)); }
async function fetchJina(url, deneme = 1) {
  if (!url || !/^https?:\/\//i.test(url)) return { status: 0, body: "", err: "gecersiz-url" };
  const cacheKey = url;
  const simdi = Date.now();
  const cch = JINA_CACHE.get(cacheKey);
  if (cch && simdi - cch.ts < CACHE_TTL_MS) return cch;
  const sonuc = await new Promise((resolve) => {
    const u = "https://r.jina.ai/" + url;
    https.get(u, { headers: { "User-Agent": UA, "Accept": "text/plain", "x-no-cache": "true" } }, (r) => {
      let b = "";
      r.on("data", (c) => { b += c; if (b.length > 900000) r.destroy(); });
      r.on("end", () => {
        if (r.statusCode && r.statusCode >= 400) {
          const cf = /Just a moment|cf-browser-verification|Attention Required/i.test(b.slice(0, 3000));
          return resolve({ status: r.statusCode, body: b, err: cf ? "jina-rate-limit (Cloudflare challenge)" : "jina HTTP " + r.statusCode });
        }
        if (b.length < 500) return resolve({ status: r.statusCode || 200, body: b, err: "jina-bos-yanit" });
        resolve({ status: r.statusCode || 200, body: b });
      });
    }).on("error", (e) => resolve({ status: 0, body: "", err: String(e.message || e).slice(0, 120) }))
      .setTimeout(35000, function () { this.destroy(); resolve({ status: 0, body: "", err: "jina-zaman-asimi" }); });
  });
  if ((sonuc.err || "").includes("jina-rate-limit") && deneme < 3) {
    const bekle = 2000 * deneme;
    await sleepMs(bekle);
    const tekrar = await fetchJina(url, deneme + 1);
    if (!tekrar.err || tekrar.body.length >= sonuc.body.length) return tekrar;
  }
  JINA_CACHE.set(cacheKey, { ...sonuc, ts: simdi });
  return sonuc;
}
/* Hepsiburada (jina Markdown): urun kartlari su sekilde gelir:
   [![...](resim)](urun-linki)
   [Baslik](urun-linki "title")  +  `XX.XXX,XX TL`
   Cozumleyici her iki formattaki -p- linkini yakalar, fiyati yakin cevreden alir. */
function parseHepsiburadaHtml(html) {
  const out = [];
  try {
    const h = String(html || "").replace(/\\"/g, '"');
    const re = /<a[^>]{0,800}?href="(\/[^"]{5,220}?-p-[A-Za-z0-9]+[^"]{0,80}?)"[^>]*>([\s\S]{0,3000}?)<\/a>/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(h)) && out.length < 24) {
      const href = m[1].split("?")[0];
      if (seen.has(href)) continue;
      const ic = m[2];
      const bm = ic.match(/title="([^"]{5,200}?)"/) || ic.match(/>([^<]{5,200}?)</);
      const baslik = temiz(bm ? bm[1] : href.replace(/-/g, " "));
      if (baslik.length < 5) continue;
      const cev = h.slice(Math.max(0, m.index - 2000), m.index + 12000);
      const pm = cev.match(/([\d.]+,\d{2})\s?TL/);
      const fiyat = pm ? trFiyat(pm[1]) : null;
      if (!fiyat) continue;
      seen.add(href);
      let resim = "";
      const im = (ic + cev).match(/src="(https:\/\/productimages\.hepsiburada\.net\/[^"]+)/);
      if (im) resim = im[1];
      out.push({ magaza: "Hepsiburada", baslik: baslik, fiyat: fiyat, link: "https://www.hepsiburada.com" + href, resim: resim });
    }
  } catch (e) { /* yut */ }
  return out;
}
function parseHepsiburada(md) {
  const out = [];
  try {
    const seen = new Set();
    const re = /\[([^\]]{3,220}?)\]\((https?:\/\/www\.hepsiburada\.com\/[^\s)]+-p-[A-Za-z0-9]+)[^)]*\)/g;
    let m;
    while ((m = re.exec(md)) && out.length < 24) {
      let baslik = temiz(m[1]);
      /* resimli kart: [![Image](..)](link) -> baslik bosa duser, atla (metin karti zaten gelir) */
      if (!baslik || /^!\[|image\s*\d*\s*:?$/i.test(baslik) || baslik.length < 5) continue;
      if (/^(sepete ekle|hemen al|favori|karsilastir|incele)$/i.test(baslik)) continue;
      const link = m[2];
      if (seen.has(link)) continue;
      const win = md.slice(m.index, m.index + 1500);
      const pm = win.match(/([\d.]+,\d{2})\s*TL/);
      const fiyat = pm ? trFiyat(pm[1]) : null;
      if (!fiyat) continue;
      seen.add(link);
      let resim = "";
      const back = md.slice(Math.max(0, m.index - 600), m.index);
      const im = (back + win).match(/\((https:\/\/productimages\.hepsiburada\.net\/[^\s)]+)\)/);
      if (im) resim = im[1];
      out.push({ magaza: "Hepsiburada", baslik: baslik, fiyat: fiyat, link: link, resim: resim });
    }
  } catch (e) { /* yut */ }
  return out;
}

/* Amazon TR arama sonuclari: gercek aria-label baslik + a-offscreen fiyat */
function parseAmazon(html) {
  const out = [];
  try {
    const seen = new Set();
    const parts = html.split('data-asin="');
    for (let i = 1; i < parts.length && out.length < 24; i++) {
      const seg = parts[i];
      const am = seg.match(/^(B[A-Z0-9]{9})/);
      if (!am) continue;
      const asin = am[1];
      if (seen.has(asin)) continue;
      const win = seg.slice(0, 45000);
      // fiyat: ilk a-offscreen blogu
      const offIdx = win.indexOf('a-offscreen');
      if (offIdx < 0) continue;
      const pm = win.slice(offIdx, offIdx + 220).match(/>([^<]{2,40}?)</);
      const fiyat = pm ? trFiyat(pm[1]) : null;
      if (!fiyat) continue;
      seen.add(asin);
      // baslik: aria-label (buton/yorum/puan/reklam etiketlerini ele, en uzun gecerli olani al)
      let baslik = '';
      const lbRe = /aria-label="([^"]{12,220}?)"/g;
      let lb, best = '';
      while ((lb = lbRe.exec(win))) {
        const s = lb[1].trim();
        if (/(sepete ekle|favorilere|listeye ekle|karsilastir|karşılaştır|paylaş|paylas|begen|beğen|hizli bakis|hızlı bakış|stokta|kargo bedava|yildiz|yıldız|inceleme|incelemede|derecelendirme|değerlendirme|puan|reyting|rating|yorum|yorumlar|urundetay|urun detay|goruntuler|görüntüler|daha fazla|renkler mevcuttur|istege|isteğe|sonraki|onceki|önceki|kampanya|indirim kodu|kupon|coupon|sepette|tuken|tüken|tukenmis|tukenmis|amazonda sat|marka:|sponsorlu reklam|son 30 gün|guvenli alis|güvenli alış|1 sini|adet satildi|adet satıldı)/i.test(s)) continue;
        if (/^\d/.test(s)) continue;
        if (s.length > best.length) best = s;
      }
      baslik = best.replace(/^Sponsorlu Reklam\s*-\s*/i, '').trim();
      if (!baslik) {
        const altRe = /alt="([^"]{12,220}?)"/g; let al;
        while ((al = altRe.exec(win))) { const s = al[1].trim(); if (/(yildiz|yildiz|inceleme|derecelendirme|puan|rating|reyting|yorum|görüntüle|goruntule|hemen al|sepete|sepete ekle|kargo bedava|stokta|renkler|kacir|kacirma)/i.test(s)) continue; if (/^\d/.test(s)) continue; baslik = s; break; }
      }
      if (!baslik) baslik = 'Amazon ürünü ' + asin;
      // link
      let link = 'https://www.amazon.com.tr/dp/' + asin;
      const lm = win.match(/href="([^"]{5,300}?\/dp\/B[A-Z0-9]{9}[^"]{0,80}?)"/);
      if (lm) {
        const h = lm[1].split('?')[0];
        link = h.startsWith('http') ? h : 'https://www.amazon.com.tr' + h;
      }
      // resim
      let resim = '';
      const im = win.match(/src="(https:\/\/m\.media-amazon\.com\/images\/[^"]{2,250})"/);
      if (im) resim = im[1];
      out.push({ magaza: 'Amazon', baslik: temiz(baslik), fiyat: fiyat, link: link, resim: resim });
    }
  } catch (e) { }
  return out;
}
function parseTrendyol(html) {
  const out = [];
  try {
    const MARK = '"products":[{"boutiqueId"';
    const mi = html.indexOf(MARK);
    if (mi < 0) return out;
    const arrStart = html.indexOf("[", mi);
    let d = 0, instr = false, esc = false, end = -1;
    for (let k = arrStart; k < html.length && k < arrStart + 3000000; k++) {
      const c = html[k];
      if (instr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') instr = false; }
      else { if (c === '"') instr = true; else if (c === "[") d++; else if (c === "]") { d--; if (d === 0) { end = k + 1; break; } } }
    }
    if (end < 0) return out;
    const arr = JSON.parse(html.slice(arrStart, end).replace(/\\u002F/g, "/"));
    const seen = new Set();
    for (const p of arr) {
      if (out.length >= 24) break;
      const pr = p.price || {};
      const fiyat = Number(pr.discountedPrice || pr.current || pr.sellingPrice || 0);
      if (!(fiyat > 0)) continue;
      const url = String(p.url || "");
      const mpid = url.match(/-p-(\d+)/);
      const anahtar = mpid ? mpid[1] : url;
      if (seen.has(anahtar)) continue;
      seen.add(anahtar);
      let link = "https://www.trendyol.com/sr?q=";
      const um = url.match(/(.+?-p-\d+)/);
      if (um) link = "https://www.trendyol.com" + um[1];
      out.push({ magaza: "Trendyol", baslik: temiz((p.brand ? p.brand + " " : "") + (p.name || "")),
        fiyat: fiyat, link: link, resim: temiz(p.image || "") });
    }
  } catch (e) { /* yut */ }
  return out;
}
/* MediaMarkt: urun kartlari (data-test ids + fiyat) */
/* MediaMarkt: ld+json ItemList (en temiz kaynak: name + offers.price + url + image) */
function parseMediaMarkt(html) {
  const out = [];
  try {
    const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]{100,60000}?)<\/script>/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(html)) && out.length < 24) {
      let js;
      try { js = JSON.parse(m[1]); } catch (e) { continue; }
      const list = js && js["@type"] === "ItemList" ? js.itemListElement : null;
      if (!list) continue;
      for (const li of list) {
        const it = li.item || li;
        if (!it || it["@type"] !== "Product") continue;
        const baslik = temiz(it.name || "");
        const offers = it.offers || {};
        const off = Array.isArray(offers) ? offers[0] : offers;
        const fiyat = off ? Number(off.price) : null;
        const link = temiz(it.url || "");
        const resim = temiz(Array.isArray(it.image) ? it.image[0] : (it.image || ""));
        if (!fiyat || !(fiyat > 0)) continue;
        const anahtar = link || baslik;
        if (seen.has(anahtar)) continue;
        seen.add(anahtar);
        out.push({ magaza: "MediaMarkt", baslik: baslik || "MediaMarkt urunu",
          fiyat: Math.round(fiyat * 100) / 100, link: link || "https://www.mediamarkt.com.tr/", resim: resim });
        if (out.length >= 24) break;
      }
    }
  } catch (e) { /* yut */ }
  return out;
}
/* JSON-LD ItemList (schema.org Product — name + offers.price + url + image).
   N11 ve PTTAVM ayni formati sunar; magaza adi ve yedek link parametre. */
function parseItemListLd(html, magaza, yedekLink) {
  const out = [];
  try {
    const re = /<script[^>]*type=\"application\/ld\+json\"[^>]*>([\s\S]{100,400000}?)<\/script>/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(html)) && out.length < 24) {
      let js;
      try { js = JSON.parse(m[1]); } catch (e) { continue; }
      const list = js && js["@type"] === "ItemList" ? js.itemListElement : null;
      if (!list) continue;
      for (const li of list) {
        const it = li.item || li;
        if (!it || it["@type"] !== "Product") continue;
        const baslik = temiz(it.name || "");
        const offers = it.offers || {};
        const off = Array.isArray(offers) ? offers[0] : offers;
        const fiyat = off ? Number(off.price) : null;
        const link = temiz(it.url || "");
        const resim = temiz(Array.isArray(it.image) ? it.image[0] : (it.image || ""));
        if (!fiyat || !(fiyat > 0)) continue;
        const anahtar = link || baslik;
        if (seen.has(anahtar)) continue;
        seen.add(anahtar);
        out.push({ magaza: magaza, baslik: baslik || magaza + " urunu",
          fiyat: Math.round(fiyat * 100) / 100, link: link || yedekLink, resim: resim });
        if (out.length >= 24) break;
      }
    }
  } catch (e) { /* yut */ }
  return out;
}
function parseN11(html) {
  return parseItemListLd(html, "N11", "https://www.n11.com/");
}
function parsePttavm(html) {
  return parseItemListLd(html, "PTTAVM", "https://www.pttavm.com/");
}
/* Pazarama: product-card-title + -p- link + price box */
function parsePazarama(html) {
  const out = [];
  try {
    const h = html.replace(/\\"/g, '"');
    const re = /<a[^>]{0,600}?href="(\/[^"]{5,220}?-p-\d+[^"]{0,60}?)"/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(h)) && out.length < 24) {
      const href = m[1];
      if (seen.has(href)) continue;
      const win = h.slice(m.index, m.index + 14000);
      if (win.indexOf("base-product-card-price") < 0) continue;
      seen.add(href);
      const pm = win.match(/([\d.]+,\d{2})\s?TL/);
      const fiyat = pm ? trFiyat(pm[1]) : null;
      if (!fiyat) continue;
      let baslik = "";
      const tm = win.match(/product-card-title[^>]*>\s*([^<]{4,180}?)\s*</);
      if (tm) baslik = temiz(tm[1]);
      if (!baslik) {
        const hm = href.match(/\/([^/?#]{8,160})-p-\d+/);
        if (hm) baslik = temiz(hm[1].replace(/-/g, " "));
      }
      let resim = "";
      const im = win.match(/<img[^>]{0,500}?src="(https:\/\/[^"]{10,220})"/);
      if (im) resim = im[1];
      out.push({ magaza: "Pazarama", baslik: baslik || "Pazarama urunu",
        fiyat: fiyat, link: "https://www.pazarama.com" + href.split("?")[0], resim: resim });
    }
  } catch (e) { /* yut */ }
  return out;
}
/* Vatan: product-list__product-name + product-list__price */
function parseVatan(html) {
  const out = [];
  try {
    const h = html.replace(/\\"/g, '"');
    const re = /product-list__product-name[^>]*>\s*<h3>([^<]{5,200}?)<\/h3>/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(h)) && out.length < 24) {
      const baslik = temiz(m[1]);
      if (seen.has(baslik)) continue;
      const back = h.slice(Math.max(0, m.index - 4000), m.index);
      const fwd = h.slice(m.index, m.index + 3000);
      const pm = fwd.match(/product-list__price[^>]*>([\d.]+)<\/span>/);
      const fiyat = pm ? trFiyat(pm[1]) : null;
      if (!fiyat) continue;
      seen.add(baslik);
      let link = "https://www.vatanbilgisayar.com/arama/";
      const lm = (back + fwd).match(/href="(https:\/\/www\.vatanbilgisayar\.com\/[^"]{5,180}?\.html)"/);
      if (lm) link = lm[1];
      out.push({ magaza: "Vatan", baslik: baslik, fiyat: fiyat, link: link, resim: "" });
    }
  } catch (e) { /* yut */ }
  return out;
}
const MAGAZALAR = [
  { id: "trendyol", ad: "Trendyol", url: (q) => "https://www.trendyol.com/sr?q=" + encodeURIComponent(q), parse: parseTrendyol },
  { id: "amazon", ad: "Amazon", url: (q) => "https://www.amazon.com.tr/s?k=" + encodeURIComponent(q), parse: parseAmazon },
  { id: "mediamarkt", ad: "MediaMarkt", url: (q) => "https://www.mediamarkt.com.tr/tr/search.html?query=" + encodeURIComponent(q), parse: parseMediaMarkt },
  { id: "pazarama", ad: "Pazarama", url: (q) => "https://www.pazarama.com/arama?q=" + encodeURIComponent(q), parse: parsePazarama },
  { id: "vatan", ad: "Vatan", url: (q) => "https://www.vatanbilgisayar.com/arama/" + encodeURIComponent(q) + "/", parse: parseVatan },
  { id: "n11", ad: "N11", url: (q) => "https://www.n11.com/arama?q=" + encodeURIComponent(q), parse: parseN11 },
  { id: "pttavm", ad: "PTTAVM", url: (q) => "https://www.pttavm.com/arama?q=" + encodeURIComponent(q), parse: parsePttavm },
  { id: "hepsiburada", ad: "Hepsiburada", url: (q) => "https://www.hepsiburada.com/ara?q=" + encodeURIComponent(q), via: "jina", parse: parseHepsiburada }
];
/* ---- Marka resmi siteleri (adim 1: katalog) ---- */
const MARKA_KATALOG = {
  apple: { ad: "Apple Store", kok: "https://www.apple.com",
    modeller: [
      { kod: "iphone duo", b: "Apple iPhone Duo", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-duo" },
      { kod: "iphone 18 pro", b: "Apple iPhone 18 Pro", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-18-pro" },
      { kod: "iphone air", b: "Apple iPhone Air", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-air" },
      { kod: "iphone 17e", b: "Apple iPhone 17e", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-17e" },
      { kod: "iphone 17", b: "Apple iPhone 17", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-17" },
      { kod: "iphone 16", b: "Apple iPhone 16", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-16" },
      { kod: "iphone 15", b: "Apple iPhone 15", u: "https://www.apple.com/tr/shop/buy-iphone/iphone-15" }
    ] },
  huawei: { ad: "Huawei Store", kok: "https://consumer.huawei.com",
    modeller: [
      { kod: "pura 90s pro max", b: "HUAWEI Pura 90s Pro Max", u: "https://consumer.huawei.com/tr/phones/pura90s-pro-max/buy/" },
      { kod: "pura 80 ultra", b: "HUAWEI Pura 80 Ultra", u: "https://consumer.huawei.com/tr/phones/pura80-ultra/buy/" },
      { kod: "pura 80 pro", b: "HUAWEI Pura 80 Pro", u: "https://consumer.huawei.com/tr/phones/pura80-pro/buy/" },
      { kod: "mate x7", b: "HUAWEI Mate X7", u: "https://consumer.huawei.com/tr/phones/mate-x7/buy/" },
      { kod: "mate x6", b: "HUAWEI Mate X6", u: "https://consumer.huawei.com/tr/phones/mate-x6/buy/" },
      { kod: "nova 14", b: "HUAWEI nova 14", u: "https://consumer.huawei.com/tr/phones/nova14/buy/" },
      { kod: "nova 13", b: "HUAWEI nova 13", u: "https://consumer.huawei.com/tr/phones/nova13/buy/" },
      { kod: "watch fit 5 pro", b: "HUAWEI Watch Fit 5 Pro", u: "https://consumer.huawei.com/tr/wearables/watch-fit5-pro/buy/" },
      { kod: "watch fit 5", b: "HUAWEI Watch Fit 5", u: "https://consumer.huawei.com/tr/wearables/watch-fit5-pro/buy/" },
      { kod: "watch fit 4", b: "HUAWEI Watch Fit 4", u: "https://consumer.huawei.com/tr/wearables/" },
      { kod: "watch gt", b: "HUAWEI Watch GT", u: "https://consumer.huawei.com/tr/wearables/" },
      { kod: "fit", b: "HUAWEI Watch Fit 5", u: "https://consumer.huawei.com/tr/wearables/watch-fit5-pro/buy/" },
      { kod: "watch", b: "HUAWEI Watch Fit 5", u: "https://consumer.huawei.com/tr/wearables/watch-fit5-pro/buy/" }
    ] },
  samsung: { ad: "Samsung Store", kok: "https://www.samsung.com",
    modeller: [
      { kod: "galaxy s26 ultra", b: "Samsung Galaxy S26 Ultra", u: "https://www.samsung.com/tr/smartphones/galaxy-s26-ultra/" },
      { kod: "galaxy s26", b: "Samsung Galaxy S26", u: "https://www.samsung.com/tr/smartphones/galaxy-s26/" },
      { kod: "galaxy s25 fe", b: "Samsung Galaxy S25 FE", u: "https://www.samsung.com/tr/smartphones/galaxy-s25-fe/" },
      { kod: "galaxy z fold", b: "Samsung Galaxy Z Fold", u: "https://www.samsung.com/tr/smartphones/galaxy-z-fold7/" },
      { kod: "galaxy z flip", b: "Samsung Galaxy Z Flip", u: "https://www.samsung.com/tr/smartphones/galaxy-z-flip7/" },
      { kod: "galaxy a56", b: "Samsung Galaxy A56", u: "https://www.samsung.com/tr/smartphones/galaxy-a56-5g/" },
      { kod: "galaxy a36", b: "Samsung Galaxy A36", u: "https://www.samsung.com/tr/smartphones/galaxy-a36-5g/" }
    ] },
  xiaomi: { ad: "Xiaomi Store", kok: "https://www.mi.com",
    modeller: [
      { kod: "redmi note 17", b: "Xiaomi Redmi Note 17", u: "https://www.mi.com/tr/product/redmi-note-17/" },
      { kod: "redmi note 14", b: "Xiaomi Redmi Note 14", u: "https://www.mi.com/tr/product/redmi-note-14/" },
      { kod: "redmi 15", b: "Xiaomi Redmi 15", u: "https://www.mi.com/tr/product/redmi-15/" },
      { kod: "xiaomi 15t", b: "Xiaomi 15T", u: "https://www.mi.com/tr/product/xiaomi-15t/" },
      { kod: "xiaomi 15", b: "Xiaomi 15", u: "https://www.mi.com/tr/product/xiaomi-15/" },
      { kod: "poco x7", b: "POCO X7", u: "https://www.mi.com/tr/product/poco-x7/" },
      { kod: "poco f7", b: "POCO F7", u: "https://www.mi.com/tr/product/poco-f7/" }
    ] }
};
function kucult(s) { return String(s == null ? "" : s).toLocaleLowerCase("tr"); }
function markaBul(q) {
  const t = " " + kucult(q).replace(/-/g, " ").replace(/\s+/g, " ").trim() + " ";
  const es = (k) => t.indexOf(" " + k + " ") >= 0;
  const out = [];
  if (es("apple") || es("iphone") || es("ipad") || es("macbook") || es("airpods")) out.push("apple");
  if (es("huawei") || es("pura") || es("mate") || es("nova")) out.push("huawei");
  /* "watch"/"fit" tek basina markasizsa Huawei varsay; baska marka varsa karistirma
     (orn "apple watch" Huawei dondurmesin) */
  if (!out.length && (es("watch") || es("fit") || es("freebuds") || es("matepad"))) out.push("huawei");
  if (es("samsung") || es("galaxy")) out.push("samsung");
  if (es("xiaomi") || es("redmi") || es("poco")) out.push("xiaomi");
  return out;
}
function modelEslestir(q, modeller) {
  const t = " " + kucult(q).replace(/-/g, " ").replace(/\+/g, " plus ").replace(/\s+/g, " ").trim() + " ";
  let enIyi = null, enUzun = 0;
  for (const m of modeller) {
    const nk = " " + String(m.kod).toLowerCase().replace(/\s+/g, " ").trim() + " ";
    if (nk.trim() && t.indexOf(nk) >= 0 && nk.trim().length > enUzun) { enIyi = m; enUzun = nk.trim().length; }
  }
  if (enIyi) return [enIyi];
  /* Tam model kodu yoksa: genel kelime eslesmesi (max 2 model) */
  const genel = kucult(q).split(/\s+/).filter((w) => w.length >= 3);
  const out = [];
  for (const m of modeller) {
    const nk = " " + String(m.kod).toLowerCase() + " ";
    if (genel.some((w) => nk.indexOf(" " + w) >= 0)) out.push(m);
    if (out.length >= 2) break;
  }
  return out;
}
function fiyatBul(html) {
  try {
    const h = String(html || "").replace(/\\"/g, '"');
    const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]{30,60000}?)<\/script>/gi;
    let m;
    while ((m = re.exec(h))) {
      let obj;
      try { obj = JSON.parse(m[1].replace(/\\u002F/g, "/")); } catch (e) { continue; }
      const aday = Array.isArray(obj) ? obj : [obj];
      for (const o of aday) {
        if (!o || typeof o !== "object") continue;
        const grup = Array.isArray(o["@graph"]) ? o["@graph"].concat([o]) : [o];
        for (const g of grup) {
          if (!g) continue;
          const prod = g["@type"] === "Product" ? g : (g.item && g.item["@type"] === "Product" ? g.item : null);
          if (!prod) continue;
          const off = prod.offers && (Array.isArray(prod.offers) ? prod.offers[0] : prod.offers);
          if (off && off.price != null) { const v = trFiyat(String(off.price)); if (v) return v; }
        }
      }
    }
    const pm = h.match(/"discountedPrice"\s*:\s*"?([\d.]+)"?/) ||
      h.match(/"price"\s*:\s*"?([\d.,]+)"?/) ||
      h.match(/([\d.]+,\d{2})\s?(?:TL)/);
    if (pm) { const v = trFiyat(pm[1]); if (v) return v; }
  } catch (e) { /* yut */ }
  return null;
}
async function markaAra(q, markaKey) {
  const kat = MARKA_KATALOG[markaKey];
  if (!kat) return [];
  const eslesen = modelEslestir(q, kat.modeller);
  const out = [];
  for (const m of eslesen.slice(0, 2)) {
    const r = await fetchHtml(m.u);
    if (!r.body || r.body.length < 3000) continue;
    const f = fiyatBul(r.body);
    if (!f) continue;
    out.push({ magaza: kat.ad, baslik: m.b, fiyat: f, link: m.u, resim: "" });
  }
  return out;
}
/* ---- alaka filtresi: sorgudaki tum tokenlar baslikta olmali + aksesuar sozlugu ---- */
const AKSESUAR = new Set([
  "kılıf", "kilif", "koruyucu", "film", "kablo", "şarj", "sarj", "powerbank", "batarya",
  "kulaklık", "kulaklik", "askı", "aski", "sticker", "kaplama", "temizleyici", "cam",
  "ekran", "cover", "case", "cases", "protector", "holder", "mount", "adapter", "popsocket",
  "tripod", "kasa", "selfie", "stand", "bumper", "wallet", "shield", "lens",
  "kordon", "kordonu", "kayis", "kayış", "kayisi", "strap", "band", "bileklik",
  "tok", "toka", "hasir", "hasır", "silikon", "metal", "orgu", "örgü",
  "sponsorlu", "sponsored", "reklam"
]);
/* ---- alaka filtresi: sorgudaki tum tokenlar baslikta olmali + aksesuar sozlugu ---- */
function alakaFiltresi(urunler, q) {
  const sorgu = kucult(q).trim();
  const tokenlar = sorgu.split(/\s+/).filter((t) => t.length >= 2);
  if (!tokenlar.length) return urunler;
  const sorguKelimeleri = new Set(sorgu.split(/\s+/));
  const sayiRe = /^\d+$/;
  const gecen = urunler.filter((u) => {
    const ad = kucult(u.baslik);
    if (!ad) return false;
    for (const t of tokenlar) {
      /* sayi tokenlari kelime siniriyla: "17" -> "117"/"170" ile eslesmesin */
      const ok = sayiRe.test(t)
        ? new RegExp("(^|\\D)" + t + "(\\D|$)").test(ad)
        : ad.indexOf(t) >= 0;
      if (!ok) return false;
    }
    /* aksesuar sozlugu: sorgunun kendisinde gecmeyen kelimeler urunu ele.
       "uyumlu / compatible" gecen baslik = aksesuardir, sorguda aksesuar yoksa ele */
    const kelimeler = ad.split(/[^0-9a-zçğıöşü]+/);
    const sorgudaAksesuar = [...sorguKelimeleri].some((s) => AKSESUAR.has(s));
    for (const k of kelimeler) {
      if (k && AKSESUAR.has(k) && !sorguKelimeleri.has(k)) return false;
      if (!sorgudaAksesuar && (k === "uyumlu" || k === "compatible" || k === "uyumluluk")) return false;
    }
    return true;
  });
  return gecen.length ? gecen : urunler; /* hic uyani yoksa sonuclari oldugu gibi birak */
}
async function canliAra(q) {
  const sonuc = { urunler: [], magazalar: {} };
  await Promise.all(MAGAZALAR.map(async (mg) => {
    const t0 = Date.now();
    try {
      /* jina https 403/limit yerse yedekler: once jina+http, sonra dogrudan site */
      let r = mg.via === "jina" ? await fetchJina(mg.url(q)) : await fetchHtml(mg.url(q));
      let yedek = null;
      if (mg.via === "jina" && (r.err || !r.body || r.body.length < 3000)) {
        const hu = mg.url(q).replace("https://", "http://");
        const r2 = await fetchJina(hu);
        if (!r2.err && r2.body && r2.body.length >= 3000) yedek = r2;
        else {
          const y = await fetchHtml(mg.url(q));
          if (y.body && y.body.length >= 3000) yedek = y;
          /* Hepsiburada anti-bot engeli icin ek proxy fallback'ler (paralel deneme, en hizli kazanir) */
          if (mg.id === "hepsiburada" && !yedek) {
            const mobilUA = "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
            const denemeler = [
              fetchHtml("https://corsproxy.io/?url=" + encodeURIComponent(mg.url(q))),
              fetchHtml("https://api.allorigins.win/raw?url=" + encodeURIComponent(mg.url(q))),
              fetchHtml(mg.url(q), ["-A", mobilUA]),
              fetchHtml("https://api.allorigins.win/get?url=" + encodeURIComponent(mg.url(q))).then((r) => {
                try {
                  const p = JSON.parse(r.body);
                  if (p.contents && p.contents.length >= 3000) return { status: 200, body: p.contents, err: "" };
                } catch (e) { /* yut */ }
                return { status: 0, body: "", err: "parse-hata" };
              }),
              fetchHtml("https://cors.isomorphic-git.org/" + encodeURIComponent(mg.url(q)))
            ];
            const sonuclar = await Promise.all(denemeler.map((p) => p.catch((e) => ({ status: 0, body: "", err: String(e.message || e) }))));
            for (const d of sonuclar) {
              if (d.body && d.body.length >= 3000 && !d.err) { yedek = d; break; }
            }
          }
        }
      }
      if (yedek) r = yedek;
      if (r.err) {
        sonuc.magazalar[mg.id] = { durum: "hata", sureMs: Date.now() - t0, adet: 0, hata: String(r.err).slice(0, 120) };
        return;
      }
      if (!r.body || r.body.length < 3000) {
        sonuc.magazalar[mg.id] = { durum: "hata", sureMs: Date.now() - t0, adet: 0, hata: r.err || ("HTTP " + r.status) };
        return;
      }
      /* Hepsiburada: jina Markdown geldiyse mg.parse, dogrudan HTML geldiyse HTML cozumleyici */
      let items = mg.parse(r.body);
      if (mg.id === "hepsiburada" && !items.length && /<[a-z][^>]*>/i.test(r.body)) {
        items = parseHepsiburadaHtml(r.body);
      }
      let hata = items.length ? "" : "Urun ayiklanamadi";
      if (!items.length && mg.id === "hepsiburada" && /G(?:ü|u)venlik|HBBlockandCaptcha|captcha/i.test(r.body || "")) {
        hata = "Hepsiburada anti-bot engeli (sunucu IP engellendi)";
      }
      console.log("RAW", mg.id, items.length, items.slice(0, 2).map((x) => x.baslik));
      sonuc.magazalar[mg.id] = { durum: items.length ? "ok" : "bos", sureMs: Date.now() - t0, adet: items.length, hata: hata };
      for (const it of items) sonuc.urunler.push(Object.assign({ id: mg.id + "-" + sonuc.urunler.length }, it));
    } catch (e) {
      sonuc.magazalar[mg.id] = { durum: "hata", sureMs: Date.now() - t0, adet: 0, hata: String(e.message || e).slice(0, 120) };
    }
  })); /* MAGAZALAR sonu */
  /* ---- Marka resmi siteleri: sorgudaki markaya gore urun sayfasindan fiyat ---- */
  const markalar = markaBul(q);
  await Promise.all(markalar.map(async (mk) => {
    const t0 = Date.now();
    try {
      const items = await markaAra(q, mk);
      sonuc.magazalar[mk] = { durum: items.length ? "ok" : "bos", sureMs: Date.now() - t0, adet: items.length, hata: items.length ? "" : "Model eslesmedi / fiyat bulunamadi" };
      for (const it of items) sonuc.urunler.push(Object.assign({ id: mk + "-" + sonuc.urunler.length }, it));
    } catch (e) {
      sonuc.magazalar[mk] = { durum: "hata", sureMs: Date.now() - t0, adet: 0, hata: String(e.message || e).slice(0, 120) };
    }
  }));
  /* DEBUG: ham urunleri sakla */
  sonuc.hamUrunler = sonuc.urunler.map(u => ({ magaza: u.magaza, baslik: u.baslik }));
  /* alaka filtresi (marka resmi siteleri haric — onlar zaten modele gore eslesti) */
  const hamAdet = sonuc.urunler.length;
  const markaUrun = sonuc.urunler.filter((u) => (u.id || "").indexOf("-") > 0 && MARKA_KATALOG[(u.id || "").split("-")[0]]);
  const diger = alakaFiltresi(sonuc.urunler.filter((u) => markaUrun.indexOf(u) < 0), q);
  console.log("AFTER-FILTER", diger.length);
  /* varyant eleme (istek 2): ayni magaza icinde renk/hafiza farki ayni urun.
     Basliktaki renk+kapasite kelimeleri silinip normalizasyon yapilir;
     ayni kokten sadece en ucuz tutulur. */
  const RENK = new Set([
    "siyah", "black", "beyaz", "white", "mavi", "blue", "mor", "purple",
    "kirmizi", "kırmızı", "red", "yesil", "yeşil", "green", "gri", "gray",
    "grey", "gumus", "gümüş", "silver", "altin", "altın", "gold", "pembe",
    "pink", "turuncu", "orange", "sari", "sarı", "yellow", "lacivert",
    "navy", "bej", "beige", "kahverengi", "brown", "titanyum", "titanium",
    "lavanta", "lavender", "mint", "nane", "gece", "midnight", "yildiz",
    "yıldız", "starlight", "uzay", "space", "ay", "moonligh", "mist",
    "grafit", "graphite", "fildisi", "sage", "ada", "haki", "zeytin"
  ]);
  /* kategori kelimeleri kokten silinir: "Fit 5 Mor" ile "Fit 5 Mor Akilli Saat" ayni kok olur */
  const KATEGORI = new Set(["akilli", "akıllı", "saat", "watch", "smartwatch", "smart", "telefon", "phone", "tablet", "bilgisayar", "kulaklik", "kulaklık"]);
  /* durumu bozuk urunler listeye hic girmez: hasarli/teshir/yenilenmis/outlet */
  const BOZUK = new Set(["hasarli", "hasarlı", "ambalaj", "teshir", "teşhir", "yenilenmis", "yenilenmiş", "refurbished", "outlet", "2.el", "ikinciel", "bozuk", "arizali", "arızalı", "kusurlu"]);
  function urunKoku(u) {
    const mag = (u.id || "").split("-")[0];
    let t = kucult(u.baslik).replace(/[()\[\],:;|/\\-]/g, " ").replace(/\s+/g, " ").trim();
    t = t.split(" ").filter((w) => {
      if (RENK.has(w)) return false;
      if (KATEGORI.has(w)) return false;
      if (/^\d+\s?(gb|tb|mb|ram|hz|inc|inç|mm|cm|w|mah)$/.test(w)) return false;
      if (/^\d+x\d+$/.test(w)) return false;
      return true;
    }).join(" ");
    return mag + "|" + t;
  }
  function bozukMu(u) {
    const kel = kucult(u.baslik).split(/[^0-9a-zçğıöşü.]+/);
    return kel.some((w) => BOZUK.has(w));
  }
  const kokGor = new Set();
  const tekil = [];
  let sirt;
  try {
    sirt = diger.filter((u) => !bozukMu(u)).slice().sort((a, b) => a.fiyat - b.fiyat);
  } catch (e) {
    console.log("SIRT-ERR", String(e.message || e));
    sirt = diger.slice();
  }
  console.log("SIRT", sirt.length);
  for (const u of sirt) {
    const k = urunKoku(u);
    if (kokGor.has(k)) continue;
    kokGor.add(k);
    tekil.push(u);
  }
  sonuc.urunler = tekil.concat(markaUrun);
  /* cesitlilik: magaza basina en ucuz 3 (resmi siteler haric — hepsi kalir).
     Boylece tek magaza (orn Pazarama) ilk 12'yi kapatamaz, her siteden sonuc gorunur. */
  const gruplar = {};
  for (const u of tekil) {
    const kid = (u.id || "").split("-")[0];
    (gruplar[kid] = gruplar[kid] || []).push(u);
  }
  for (const k of Object.keys(gruplar)) {
    gruplar[k].sort((a, b) => a.fiyat - b.fiyat);
    gruplar[k] = gruplar[k].slice(0, 5);
  }
  /* istek 1: magaza gruplari yan yana — her magazanin 3'u blok halinde,
     bloklar magaza adina gore sirali (N11'ler yanyana, Trendyol'lar yanyana).
     Onceki tur sistemi kaldirildi. */
  const bloklu = [];
  for (const k of Object.keys(gruplar).sort()) bloklu.push(...gruplar[k]);
  markaUrun.sort((a, b) => a.fiyat - b.fiyat);
  /* siralama: marka resmi sitesi en ustte (pahali olsa bile), sonra magaza bloklari */
  sonuc.urunler = markaUrun.concat(bloklu);
  console.log("FINAL-COUNT", sonuc.urunler.length, sonuc.urunler.map(u=>u.magaza).join(","));
  const sayim2 = {};
  for (const u of sonuc.urunler) {
    const kid = (u.id || "").split("-")[0];
    sayim2[kid] = (sayim2[kid] || 0) + 1;
  }
  for (const k of Object.keys(sonuc.magazalar)) {
    const s = sonuc.magazalar[k];
    if (s.durum === "hata") continue;
    s.adet = sayim2[k] || 0;
    if (s.durum === "ok" && !s.adet) { s.durum = "bos"; s.hata = "Ilgisiz urunler elendi"; }
  }
  sonuc.hamAdet = hamAdet;
  return sonuc;
}

/* ---- takip veritabani ---- */
function dbOku() { try { const d = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); if (!d.takipler) d.takipler = []; return d; } catch (e) { return { takipler: [] }; } }
function dbYaz(d) { try { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2), "utf8"); } catch (e) { /* yut */ } }
function uid() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
/* ---- arka plan: 30 dakikada bir fiyatlari tazele ---- */
let kilit = false;
async function takipKontrolu() {
  if (kilit) return;
  kilit = true;
  try {
    const db = dbOku();
    for (const t of db.takipler) {
      if (!t.aktif) continue;
      try {
        const r = await fetchHtml(t.link);
        if (r.body && r.body.length > 3000) {
          /* generic cikarici: JSON-LD Product -> og/title -> a-offscreen/discountedPrice/TL kalibi (linkCoz) */
          const coz = linkCoz(t.link, r.body);
          const f = coz && coz.fiyat > 0 ? coz.fiyat : null;
          t.sonKontrol = new Date().toISOString();
          if (f && f > 0) {
            t.sonDurum = "ok";
            if (Math.abs(f - (t.sonFiyat || t.referansFiyat)) > 0.005) {
              if (!t.gecmis) t.gecmis = [];
              t.gecmis.push({ tarih: t.sonKontrol, fiyat: f });
              if (t.gecmis.length > 60) t.gecmis = t.gecmis.slice(-60);
            }
            t.sonFiyat = f;
            if (f < t.referansFiyat && !t.indirimBildirdi) {
              t.indirimBildirdi = true; t.indirimTarihi = t.sonKontrol;
              const yuzde = Math.round((1 - f / t.referansFiyat) * 1000) / 10;
              tgBildirim("🔔 <b>İndirim!</b>\n" + htmlesc(t.baslik) + "\n" +
                tlb(t.referansFiyat) + " → <b>" + tlb(f) + " TL</b> (-%" + yuzde + ")\n" + htmlesc(t.link || ""));
            }
            else if (f >= t.referansFiyat) t.indirimBildirdi = false;
          } else t.sonDurum = "fiyat-bulunamadi";
        } else t.sonDurum = "erisim-hatasi";
      } catch (e) { t.sonDurum = "hata"; }
      await new Promise((r2) => setTimeout(r2, 1500));
    }
    dbYaz(db);
  } finally { kilit = false; }
}
setInterval(takipKontrolu, 30 * 60 * 1000);
setTimeout(takipKontrolu, 20000);
/* ---- indirim gunu bildirimleri ---- */
async function indirimGunleriListesi(limitGun) {
  limitGun = limitGun || 90;
  const now = new Date();
  const out = [];
  for (const k of IG.INDIRIM_GUNLERI) {
    const d = IG.sonrakiTarih(k, now);
    const fark = IG.gunFarki(d);
    if (fark >= 0 && fark <= limitGun) out.push({ key: k.key, ad: k.ad, emoji: k.emoji, tarih: d.toISOString(), gunKaldi: fark, aciklama: k.aciklama, marketler: k.marketler });
  }
  out.sort((a, b) => a.gunKaldi - b.gunKaldi);
  return out;
}
async function indirimGunuBildirimKontrolu() {
  try {
    const db = dbOku();
    if (!db.indirimBildirimleri) db.indirimBildirimleri = {};
    const now = new Date();
    let degisti = false;
    for (const k of IG.INDIRIM_GUNLERI) {
      const d = IG.sonrakiTarih(k, now);
      const fark = IG.gunFarki(d);
      if (fark !== 7 && fark !== 1 && fark !== 0) continue;
      const anahtar = k.key + "|" + d.toISOString().slice(0, 10) + "|" + fark;
      if (db.indirimBildirimleri[anahtar]) continue;
      const gunMetni = fark === 0 ? "BUGÜN" : (fark === 1 ? "YARIN indirim başlıyor!" : (fark + " gün sonra"));
      const baslik = fark === 1 ? "📅 <b>Yarın İndirim Başlıyor!</b>" : "📅 <b>İndirim Günü Yaklaşıyor!</b>";
      tgBildirim(baslik + "\n" + htmlesc(k.emoji + " " + k.ad) + "\n" + gunMetni + " — " + d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) + "\n" + htmlesc(k.aciklama || "") + "\n" + (k.marketler || []).join(", "));
      db.indirimBildirimleri[anahtar] = new Date().toISOString();
      degisti = true;
    }
    if (degisti) dbYaz(db);
  } catch (e) { if (global.console) console.log("indirimGunuBildirimKontrolu hata: " + String(e.message || e)); }
}
async function testBildirimiGonder() {
  const liste = await indirimGunleriListesi(30);
  const ilk = liste.length ? liste[0] : null;
  const metin = "✅ <b>Test Bildirimi</b>\nİndirim günü bildirimleri çalışıyor.\n" + (ilk ? ("Sıradaki: " + htmlesc(ilk.emoji + " " + ilk.ad) + " — " + ilk.gunKaldi + " gün kaldı") : "Yaklaşan indirim günü yok.");
  tgBildirim(metin);
  return { ok: true, gonderildi: !!tgSohbet() };
}
setInterval(indirimGunuBildirimKontrolu, 24 * 60 * 60 * 1000);
setTimeout(indirimGunuBildirimKontrolu, 30000);
/* ---- tek urun linkinden ad + fiyat coz ---- */
function linkCoz(link, html) {
  const host = ((link.match(/^https?:\/\/([^\/]+)/) || [, ""])[1] || "").replace(/^www\./, "").toLowerCase();
  let baslik = "", fiyat = null, resim = "";
  try {
    const ldRe = /<script[^>]*application\/ld\+json[^>]*>([\s\S]{30,12000}?)<\/script>/gi;
    let m;
    while ((m = ldRe.exec(html))) {
      let obj;
      try { obj = JSON.parse(m[1].replace(/\\u002F/g, "/")); } catch (e) { continue; }
      const aday = Array.isArray(obj) ? obj : [obj];
      for (const o of aday) {
        if (!o || typeof o !== "object") continue;
        const grup = Array.isArray(o["@graph"]) ? o["@graph"].concat([o]) : [o];
        for (const g of grup) {
          if (!g) continue;
          const prod = g["@type"] === "Product" ? g : (g.item && g.item["@type"] === "Product" ? g.item : null);
          if (!prod) continue;
          if (!baslik && prod.name) baslik = String(prod.name);
          const off = prod.offers && (Array.isArray(prod.offers) ? prod.offers[0] : prod.offers);
          if (!fiyat && off && off.price != null) { const v = trFiyat(String(off.price)); if (v) fiyat = v; }
          if (!resim) { const im = Array.isArray(prod.image) ? prod.image[0] : prod.image; if (typeof im === "string") resim = im; else if (im && im.url) resim = im.url; }
        }
        if (baslik && fiyat) break;
      }
      if (baslik && fiyat) break;
    }
    if (!baslik) { const t = html.match(/property="og:title"\s+content="([^"]{3,220})"/) || html.match(/content="([^"]{3,220})"\s+property="og:title"/); if (t) baslik = t[1]; }
    if (!baslik) { const t = html.match(/<title[^>]*>([^<]{3,220})<\/title>/i); if (t) baslik = t[1]; }
    if (!resim) { const im = html.match(/property="og:image"\s+content="([^"]{10,300})"/) || html.match(/content="([^"]{10,300})"\s+property="og:image"/); if (im) resim = im[1]; }
    if (!fiyat) {
      const pm = html.match(/a-offscreen[^>]*>\s*([\d.]+,\d{2})/) ||
        html.match(/"discountedPrice"\s*:\s*"?([\d.]+)"?/) ||
        html.match(/"price"\s*:\s*"?([\d.,]+)"?/) ||
        html.match(/([\d.]+,\d{2})\s?(?:TL|₺)/);
      if (pm) { const v = trFiyat(pm[1]); if (v) fiyat = v; }
    }
  } catch (e) { /* yut */ }
  if (!baslik) return null;
  return {
    baslik: baslik.replace(/\s+/g, " ").replace(/&amp;/g, "&").trim().slice(0, 220),
    fiyat: fiyat || 0,
    link: link,
    resim: resim || "",
    magaza: host
  };
}
/* ---- telegram bot (sifir bagimlilik — long-polling; token: TELEGRAM_BOT_TOKEN) ---- */
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
let TG_OFFSET = 0, TG_DURDU = false;
const TG_ARAMA = new Map(); /* chatId -> {tarih, arama, urunler} — buton icin gecici onbellek */
function tgApi(method, payload) {
  return new Promise((resolve) => {
    const veri = Buffer.from(JSON.stringify(payload || {}), "utf8");
    let bitti = false;
    const son = (o) => { if (!bitti) { bitti = true; resolve(o); } };
    const req = https.request({
      host: "api.telegram.org", path: "/bot" + TG_TOKEN + "/" + method, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": veri.length }, timeout: 45000
    }, (r) => {
      let b = "";
      r.on("data", (c) => { b += c; if (b.length > 4000000) r.destroy(); });
      r.on("end", () => { try { son(JSON.parse(b)); } catch (e) { son({ ok: false, description: "json-hata" }); } });
    });
    req.on("error", (e) => son({ ok: false, description: String(e.message || e) }));
    req.on("timeout", () => { req.destroy(); son({ ok: false, description: "zaman-asimi" }); });
    req.write(veri);
    req.end();
  });
}
function htmlesc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function tlb(n) { try { return Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 }); } catch (e) { return String(n); } }
function tgSohbet() { const d = dbOku(); return d.telegram || null; }
function tgBagla(chatId) {
  const d = dbOku();
  d.telegram = Object.assign({}, d.telegram, { chatId: chatId, baglama: new Date().toISOString() });
  dbYaz(d);
}
async function tgGonder(chatId, metin, klavye) {
  if (!TG_TOKEN || !chatId) return false;
  const p = { chat_id: chatId, text: String(metin).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true };
  if (klavye) p.reply_markup = klavye;
  const r = await tgApi("sendMessage", p);
  if (!r.ok && global.console) console.log("Telegram sendMessage hatasi: " + String(r.description || "").slice(0, 120));
  return !!r.ok;
}
function tgBildirim(metin) {
  const t = tgSohbet();
  if (t && t.chatId) tgGonder(t.chatId, metin); /* fire-and-forget */
}
/* HTTP route'lar ve bot paylasir */
function takipKaydet(b) {
  if (!b || !b.baslik || !(b.fiyat > 0)) return { hata: "baslik + fiyat gerekli" };
  const db = dbOku();
  const kayit = { id: uid(), baslik: String(b.baslik).slice(0, 220), referansFiyat: Number(b.fiyat),
    sonFiyat: Number(b.fiyat), link: String(b.link || ""), resim: String(b.resim || ""),
    magaza: String(b.magaza || ""), arama: String(b.arama || ""), aktif: true, indirimBildirdi: false,
    olusturma: new Date().toISOString(), sonKontrol: null, sonDurum: "yeni",
    gecmis: [{ tarih: new Date().toISOString(), fiyat: Number(b.fiyat) }] };
  db.takipler.unshift(kayit);
  dbYaz(db);
  return kayit;
}
function takipSil(id) {
  const db = dbOku();
  const on = db.takipler.length;
  db.takipler = db.takipler.filter((t) => t.id !== id);
  dbYaz(db);
  return db.takipler.length < on;
}
const TG_YARDIM =
  "🧮 <b>İndirim Takip Bot</b>\n\n" +
  "/ara <i>kelime</i> — mağazalarda ara, sonuçdan butonla takibe al\n" +
  "/takipler — takip listesi + son fiyatlar\n" +
  "/indirimler — yaklaşan indirim günleri\n" +
  "/testbildirim — bildirim testi gönder\n" +
  "/kontrol — fiyatları hemen kontrol et\n" +
  "/yardim — bu mesaj\n\n" +
  "🔔 Fiyat, takibe aldığın referansın altına inerse bildirim gelir.\n" +
  "📅 İndirim günleri 7/1/0 gün kala otomatik bildirim gelir.\n" +
  "Silme: /takipler listesindeki 🗑 butonları.";
async function tgTakipListesi(chatId) {
  const liste = dbOku().takipler || [];
  if (!liste.length) return tgGonder(chatId, "📭 Takip listesi boş.\n<code>/ara iphone 17</code> ile arama yap.");
  const ilk = liste.slice(0, 20);
  const satirlar = ilk.map((t, i) => {
    const ind = t.referansFiyat > 0 && t.sonFiyat < t.referansFiyat;
    const yuzde = ind ? Math.round((1 - t.sonFiyat / t.referansFiyat) * 1000) / 10 : 0;
    return (i + 1) + ". <b>" + htmlesc(String(t.baslik).slice(0, 70)) + "</b>\n  💰 " +
      tlb(t.sonFiyat || t.referansFiyat) + " TL (ref " + tlb(t.referansFiyat) + " TL)" +
      (ind ? " 🔔 <b>-%" + yuzde + "</b>" : "") + "  📌 " + htmlesc(t.sonDurum || "-");
  });
  const klavye = { inline_keyboard: ilk.map((t, i) => [
    { text: "🗑 " + (i + 1) + ". " + String(t.baslik).replace(/\s+/g, " ").slice(0, 40), callback_data: "s" + t.id }
  ]) };
  return tgGonder(chatId, "📋 <b>Takipler</b> (" + liste.length + ")\n\n" + satirlar.join("\n\n"), klavye);
}
async function tgTiklama(cb) {
  const chatId = cb.message && cb.message.chat.id;
  const data = String(cb.data || "");
  const yanit = (metin, gizli) => tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: metin, show_alert: !gizli });
  const tg = tgSohbet();
  if (!tg || tg.chatId !== chatId) return yanit("Bot bağlı değil — /start yaz", false);
  if (data.charAt(0) === "t") {
    const idx = parseInt(data.slice(1), 10);
    const k = TG_ARAMA.get(chatId);
    const u = k && k.urunler[idx];
    if (!u || Date.now() - k.tarih > 30 * 60 * 1000) return yanit("Arama eskidi — /ara ile yenile", true);
    const kayit = takipKaydet({ baslik: u.baslik, fiyat: u.fiyat, link: u.link, resim: u.resim, magaza: u.magaza, arama: k.arama });
    if (kayit.hata) return yanit("Hata: " + kayit.hata, false);
    return yanit("✅ Takibe alındı — " + String(u.baslik).slice(0, 50), true);
  }
  if (data.charAt(0) === "s") {
    const silindi = takipSil(data.slice(1));
    return yanit(silindi ? "🗑 Silindi" : "Kayıt bulunamadı", true);
  }
  return yanit("Bilinmeyen işlem", true);
}
async function tgIsle(up) {
  const cb = up.callback_query;
  if (cb) return tgTiklama(cb);
  const msg = up.message;
  if (!msg || typeof msg.text !== "string") return;
  const chatId = msg.chat.id;
  const metin = msg.text.trim();
  const bos = metin.indexOf(" ");
  const komut = (bos < 0 ? metin : metin.slice(0, bos)).toLowerCase();
  const argo = bos < 0 ? "" : metin.slice(bos + 1).trim();
  const tg = tgSohbet();
  if (komut === "/baglan") {
    tgBagla(chatId);
    return tgGonder(chatId, "✅ Bu sohbet bağlandı (önceki bağlantı taşındı).\n\n" + TG_YARDIM);
  }
  if (komut === "/start") {
    if (!tg || !tg.chatId) { tgBagla(chatId); return tgGonder(chatId, "✅ Bağlandın!\n\n" + TG_YARDIM); }
    if (tg.chatId === chatId) return tgGonder(chatId, TG_YARDIM);
    return tgGonder(chatId, "🔒 Bot başka bir sohbete bağlı. Buraya taşımak için <code>/baglan</code> yaz.");
  }
  if (!tg || tg.chatId !== chatId) return tgGonder(chatId, "🔒 Başlamak için <code>/start</code> yaz.");
  if (komut === "/yardim" || komut === "/help") return tgGonder(chatId, TG_YARDIM);
  if (komut === "/ara") {
    if (argo.length < 2) return tgGonder(chatId, "Kullanım: <code>/ara iphone 17</code>");
    await tgGonder(chatId, "🔍 <b>" + htmlesc(argo) + "</b> aranıyor — mağazalar taranıyor...");
    const sonuc = await canliAra(argo);
    const ilk = (sonuc.urunler || []).slice(0, 12);
    if (!ilk.length) return tgGonder(chatId, "Sonuç bulunamadı. Başka bir kelime dene.");
    const satirlar = ilk.map((u, i) =>
      (i + 1) + ". <b>" + htmlesc(String(u.baslik).slice(0, 90)) + "</b>\n   💰 " + tlb(u.fiyat) + " TL — " + htmlesc(u.magaza || ""));
    const klavye = { inline_keyboard: ilk.map((u, i) => [
      { text: "➕ " + tlb(u.fiyat) + " TL — " + String(u.baslik).slice(0, 36), callback_data: "t" + i }
    ]) };
    TG_ARAMA.set(chatId, { tarih: Date.now(), arama: argo, urunler: ilk });
    return tgGonder(chatId,
      "🔍 <b>" + htmlesc(argo) + "</b> — " + sonuc.urunler.length + " ilgili ürün\n\n" +
      satirlar.join("\n\n") + "\n\n⬇️ <i>Takibe almak için butona bas</i>", klavye);
  }
  if (komut === "/takipler") return tgTakipListesi(chatId);
  if (komut === "/indirimler" || komut === "/indirim-gunleri") {
    const liste = await indirimGunleriListesi(60);
    if (!liste.length) return tgGonder(chatId, "Yaklaşan indirim günü yok.");
    const satirlar = liste.map((x) => x.emoji + " <b>" + htmlesc(x.ad) + "</b> — " + x.gunKaldi + " gün kaldı (" + new Date(x.tarih).toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) + ")");
    return tgGonder(chatId, "📅 <b>Yaklaşan İndirim Günleri</b>\n\n" + satirlar.join("\n"));
  }
  if (komut === "/testbildirim") {
    const r = await testBildirimiGonder();
    return tgGonder(chatId, r.gonderildi ? "✅ Test bildirimi gönderildi (Telegram'a bak)." : "⚠️ Telegram bağlı değil veya token yok. /start ile bağla.");
  }
  if (komut === "/kontrol") {
    await tgGonder(chatId, "⏳ Fiyatlar kontrol ediliyor (birkaç saniye)...");
    try { await takipKontrolu(); } catch (e) { /* yut */ }
    return tgTakipListesi(chatId);
  }
  return tgGonder(chatId, "Bilinmeyen komut. <code>/yardim</code> yaz.");
}
async function tgDongu() {
  if (!TG_TOKEN) { console.log("Telegram: TELEGRAM_BOT_TOKEN tanımlı değil — bot kapalı"); return; }
  console.log("Telegram: bot başladı (long-polling)...");
  while (!TG_DURDU) {
    const r = await tgApi("getUpdates", { offset: TG_OFFSET, timeout: 25, allowed_updates: ["message", "callback_query"] });
    if (!r.ok) {
      const d = String(r.description || "");
      if (r.error_code === 409 || /conflict/i.test(d)) { await new Promise((x) => setTimeout(x, 10000)); continue; }
      if (r.error_code === 401 || /unauthorized/i.test(d)) { console.log("Telegram: token geçersiz — bot durduruldu"); TG_DURDU = true; break; }
      await new Promise((x) => setTimeout(x, 5000)); continue;
    }
    for (const up of (r.result || [])) {
      TG_OFFSET = up.update_id + 1;
      try { await tgIsle(up); } catch (e) { console.log("Telegram işleme hatası: " + String(e.message || e).slice(0, 120)); }
    }
  }
}
tgDongu();
/* ---- HTTP ---- */
function json(res, kod, obj) {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(kod, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Content-Length": b.length });
  res.end(b);
}
function govdeOku(req) {
  return new Promise((resolve) => {
    const ch = [];
    req.on("data", (c) => ch.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8") || "{}")); } catch (e) { resolve({}); } });
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    const yol = u.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      return res.end();
    }
    if (yol === "/api/ara" && req.method === "GET") {
      const q = (u.searchParams.get("q") || "").trim();
      if (q.length < 2) return json(res, 400, { hata: "En az 2 harf yazin" });
      return json(res, 200, Object.assign({ arama: q }, await canliAra(q)));
    }
    if (yol === "/api/takipler" && req.method === "GET") return json(res, 200, dbOku().takipler);
    if (yol === "/api/takip" && req.method === "POST") {
      const b = await govdeOku(req);
      const kayit = takipKaydet(b);
      if (kayit.hata) return json(res, 400, { hata: kayit.hata });
      return json(res, 200, kayit);
    }
        if (yol === "/api/coz" && req.method === "POST") {
      const b = await govdeOku(req);
      const link = String(b.link || "").trim();
      if (!/^https?:\/\//i.test(link)) return json(res, 400, { hata: "Gecerli bir urun linki girin (http/https)" });
      const r = await fetchHtml(link);
      if (!r.body || r.body.length < 2000) return json(res, 502, { hata: "Sayfa acilamadi: " + (r.err || ("HTTP " + r.status)) });
      const coz = linkCoz(link, r.body);
      if (!coz || !(coz.fiyat > 0)) return json(res, 404, { hata: "Sayfadan fiyat cikarilamadi — magaza bot korumasi olabilir" });

      /* Daha uygun alternatif urun aramasi: cozulen baslikta anahtar kelimeler cikar,
         canliAra ile diger magazalara bak, daha ucuz olanlari alternatif olarak dondur. */
      let alternatifler = [];
      try {
        const kelime = coz.baslik
          .replace(/\b(TL|fiyat|kampanya|indirim|kupon|teslimat|kargo|sifir|garanti)\b/gi, "")
          .replace(/[^\w\sçğıöşüÇĞİÖŞÜ]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 70);
        if (kelime.length >= 3) {
          let sonuc;
          try {
            sonuc = await Promise.race([
              canliAra(kelime),
              new Promise((_, rej) => setTimeout(() => rej(new Error('coz-alt-timeout')), 8000))
            ]);
          } catch (e) {
            sonuc = { urunler: [] };
          }
          const hedefMagaza = coz.magaza;
          const hedefFiyat = coz.fiyat;
          const secilen = new Set();
          /* Orjinal basliktan anlamli kelimeleri cikar (>=4 harf) ve alternate baslikta en az birinin gecmesini zorunlu kila */
          const orjKelimeler = coz.baslik
            .toLowerCase()
            .replace(/[^\w\sçğıöşü]/g, ' ')
            .split(/\s+/)
            .filter(k => k.length >= 4)
            .filter((k, i, arr) => arr.indexOf(k) === i);
          function baslikEslesir(aBaslik) {
            const aK = aBaslik.toLowerCase().replace(/[^\w\sçğıöşü]/g, ' ').split(/\s+/);
            return orjKelimeler.some(k => aK.indexOf(k) >= 0);
          }
          for (const u of (sonuc.urunler || [])) {
            if (!u || !u.magaza || u.magaza === hedefMagaza) continue;
            if (u.fiyat <= 0 || u.fiyat >= hedefFiyat * 0.95) continue;
            if (secilen.has(u.link)) continue;
            if (!baslikEslesir(u.baslik || '')) continue; /* baslikta ortak kelime yoksa atla */
            secilen.add(u.link);
            alternatifler.push(u);
            if (alternatifler.length >= 3) break;
          }
        }
      } catch (e) { /* alternatif arama istege bagli, hata yutulur */ }

      return json(res, 200, Object.assign({ alternatifler: alternatifler }, coz));
    }if (yol === "/api/kontrol" && req.method === "POST") { takipKontrolu().catch(() => {}); return json(res, 200, { ok: true }); }
    if (yol === "/api/indirim-gunleri" && req.method === "GET") return json(res, 200, await indirimGunleriListesi(365));
    if (yol === "/api/indirim-bildirim-test" && req.method === "POST") return json(res, 200, await testBildirimiGonder());
    const mDel = yol.match(/^\/api\/takip\/([A-Za-z0-9]+)$/);
    if (mDel && req.method === "DELETE") {
      takipSil(mDel[1]);
      return json(res, 200, { ok: true });
    }
    const ARAYUZ = path.join(__dirname, "..");
    let dosya = yol === "/" ? "index.html" : yol.replace(/^\//, "");
    dosya = path.normalize(path.join(ARAYUZ, dosya));
    if (!dosya.startsWith(ARAYUZ)) return json(res, 403, { hata: "yasak" });
    if (!fs.existsSync(dosya) || fs.statSync(dosya).isDirectory()) return json(res, 404, { hata: "yok" });
    const ext = path.extname(dosya).toLowerCase();
    const tip = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
    res.writeHead(200, { "Content-Type": tip });
    fs.createReadStream(dosya).pipe(res);
  } catch (e) { return json(res, 500, { hata: String(e.message || e).slice(0, 200) }); }
});
server.listen(PORT, () => console.log("Sunucu: http://localhost:" + PORT));

