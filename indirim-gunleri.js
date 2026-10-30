"use strict";
function nthWeekday(y, month, weekday, n) {
  const d = new Date(y, month, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) { count++; if (count === n) return new Date(d); }
    d.setDate(d.getDate() + 1);
    if (d.getMonth() !== month) break;
  }
  return new Date(y, month, 1);
}
function blackFriday(y) {
  const d = new Date(y, 10, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 21);
  return d;
}
const INDIRIM_GUNLERI = [
  { key: "yeni-yil", ad: "Yeni Yıl İndirimleri", emoji: "🎆", tur: "fixed", ay: 1, gun: 1, aciklama: "Yılbaşı sonrası sezon indirimleri", marketler: ["Trendyol", "Hepsiburada", "Amazon", "N11"] },
  { key: "sevgililer", ad: "Sevgililer Günü İndirimleri", emoji: "💝", tur: "fixed", ay: 2, gun: 14, aciklama: "Hediye ve kozmetik kampanyaları", marketler: ["Trendyol", "Hepsiburada", "Çiçeksepeti"] },
  { key: "kadinlar", ad: "Dünya Kadınlar Günü İndirimleri", emoji: "👩", tur: "fixed", ay: 3, gun: 8, aciklama: "Kadın giyim, kozmetik fırsatları", marketler: ["Trendyol", "Hepsiburada", "Amazon"] },
  { key: "anneler", ad: "Anneler Günü İndirimleri", emoji: "🌷", tur: "anneller", aciklama: "Hediye ve ev eşyası kampanyaları", marketler: ["Trendyol", "Hepsiburada", "Çiçeksepeti"] },
  { key: "babalar", ad: "Babalar Günü İndirimleri", emoji: "👔", tur: "babalar", aciklama: "Teknoloji ve hobi fırsatları", marketler: ["Trendyol", "Hepsiburada", "Amazon"] },
  { key: "yaz", ad: "Yaz İndirimleri", emoji: "☀️", tur: "fixed", ay: 7, gun: 1, aciklama: "Yaz sezonu açılış indirimleri", marketler: ["Trendyol", "Hepsiburada", "Zara", "Bershka"] },
  { key: "prime-day", ad: "Amazon Prime Day", emoji: "📦", tur: "fixed", ay: 7, gun: 15, aciklama: "Amazon'un yıllık büyük indirim etkinliği", marketler: ["Amazon"] },
  { key: "okula-donus", ad: "Okula Dönüş İndirimleri", emoji: "🎒", tur: "fixed", ay: 9, gun: 1, aciklama: "Kırtasiye ve elektronik kampanyaları", marketler: ["Trendyol", "Hepsiburada", "Vatan", "MediaMarkt"] },
  { key: "9-9", ad: "9.9 İndirim Günü", emoji: "9️⃣", tur: "fixed", ay: 9, gun: 9, aciklama: "Eylül ayı çift haneli indirim günü", marketler: ["Trendyol", "Hepsiburada", "N11", "Pazarama"] },
  { key: "10-10", ad: "10.10 İndirim Günü", emoji: "🔟", tur: "fixed", ay: 10, gun: 10, aciklama: "Ekim ayı çift haneli indirim günü", marketler: ["Trendyol", "Hepsiburada", "N11", "Amazon"] },
  { key: "efsane-kasim", ad: "Efsane Kasım", emoji: "🍁", tur: "period", ay: 11, gun: 1, bitisAy: 11, bitisGun: 30, aciklama: "Kasım ayı boyunca süren geniş kampanya dönemi", marketler: ["Trendyol", "Hepsiburada", "Amazon", "N11"] },
  { key: "11-11", ad: "11.11 İndirim Günü", emoji: "🎯", tur: "fixed", ay: 11, gun: 11, aciklama: "Yılın en büyük tek gün indirim etkinliği (Single's Day)", marketler: ["Trendyol", "Hepsiburada", "N11", "Amazon", "Pazarama"] },
  { key: "black-friday", ad: "Black Friday / Efsane Cuma / Muhteşem Cuma", emoji: "🛍️", tur: "blackfriday", aciklama: "Kasım ayının 4. cuması: büyük indirimler", marketler: ["Trendyol", "Hepsiburada", "Amazon", "MediaMarkt", "Vatan", "Zara"] },
  { key: "cyber-monday", ad: "Cyber Monday (Siber Pazartesi)", emoji: "💻", tur: "cybermonday", aciklama: "Black Friday sonrası çevrim içi odaklı indirim günü", marketler: ["Trendyol", "Hepsiburada", "Amazon", "MediaMarkt"] },
  { key: "12-12", ad: "12.12 İndirim Günü", emoji: "1️⃣2️⃣", tur: "fixed", ay: 12, gun: 12, aciklama: "Aralık ayı çift haneli indirim günü", marketler: ["Trendyol", "Hepsiburada", "N11", "Amazon"] },
  { key: "yilbasi", ad: "Yılbaşı Alışverişleri", emoji: "🎄", tur: "fixed", ay: 12, gun: 15, aciklama: "Yılsonu hediye ve kampanya dönemi", marketler: ["Trendyol", "Hepsiburada", "Amazon", "Çiçeksepeti"] }
];
function sonrakiTarih(k, now) {
  now = now || new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (k.tur === "fixed") {
    let d = new Date(now.getFullYear(), k.ay - 1, k.gun);
    if (d < today) d = new Date(now.getFullYear() + 1, k.ay - 1, k.gun);
    return d;
  }
  if (k.tur === "blackfriday") {
    let d = blackFriday(now.getFullYear());
    if (d < today) d = blackFriday(now.getFullYear() + 1);
    return d;
  }
  if (k.tur === "cybermonday") {
    const bf = sonrakiTarih({ tur: "blackfriday" }, now);
    const d = new Date(bf); d.setDate(d.getDate() + 3); return d;
  }
  if (k.tur === "anneller") {
    let d = nthWeekday(now.getFullYear(), 4, 0, 2);
    if (d < today) d = nthWeekday(now.getFullYear() + 1, 4, 0, 2);
    return d;
  }
  if (k.tur === "babalar") {
    let d = nthWeekday(now.getFullYear(), 5, 0, 3);
    if (d < today) d = nthWeekday(now.getFullYear() + 1, 5, 0, 3);
    return d;
  }
  if (k.tur === "period") {
    const bitis = new Date(now.getFullYear(), k.bitisAy - 1, k.bitisGun);
    if (today <= bitis) return new Date(now.getFullYear(), k.ay - 1, k.gun);
    return new Date(now.getFullYear() + 1, k.ay - 1, k.gun);
  }
  return today;
}
function gunFarki(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}
module.exports = { INDIRIM_GUNLERI, sonrakiTarih, gunFarki, blackFriday, nthWeekday };
