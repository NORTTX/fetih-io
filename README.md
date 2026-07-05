# Fetih.io

Territorial.io mantığında, tarayıcıda çalışan fetih oyunu. Aşama 1: tek oyunculu + 26 bot.

## Çalıştırma

`index.html` dosyasına çift tıkla — kurulum gerekmez, doğrudan tarayıcıda açılır.

## Çevrimiçi oynama

- **Oda Kur** düğmesiyle 4 harfli oda kodu ve paylaşılabilir link alırsın.
- Arkadaşların linke tıklayarak (veya kodu girerek) katılır — 30 saniyelik lobi
  geri sayımında herkes haritada doğum yerini seçer, süre bitince oyun başlar.
- Eksik kalan yerleri botlar doldurur. Oda kurucusunun sekmesi açık kalmalı
  (oyunu o yönetir). Teknik: WebRTC (PeerJS) üzerinden tarayıcıdan tarayıcıya,
  deterministik kilit-adım senkronizasyonu — oyun sunucusu gerekmez.

## Nasıl oynanır

- **Harita seçimi:** 🌍 Dünya, 🏰 Avrupa, ⚓ Akdeniz (gerçek haritalar) veya
  🏝️ Takımada, ⚔️ İki Kıta, 🎲 Kıta (her seferinde yeni üretilir).
- **Binalar:** Kendi toprağına tıkla → 🏙️ Şehir (gelir +%10, tavan artar),
  🗼 Kule (bölgesel savunma 2x), ⚓ Liman (gemi vergisi/erimesi azalır; kıyı gerekir).
  Maliyetler her yeni binada katlanır. Binalar yıkılmaz — fetheden ele geçirir!
- **Oyun ayarları:** Katılımcı sayısı (2-40) ve takım modu (FFA / 2 / 3 / 4 takım).
  Takım modunda takım arkadaşlarına saldıramazsın; takımının toplam %60'ıyla kazanırsın.
- **Başlangıç:** Bir kıtada yere tıkla, oraya doğarsın.
- **Yönlü saldırı (ordu emri):** Kendi toprağından farenin sol tuşuyla tut, hedefe doğru
  sürükle — sarı ok çıkar. Bırakınca ordu o noktaya DOĞRU koridor açarak fetheder.
  Hedef denizaşırıysa ok otomatik gemiye dönüşür. Haritayı kaydırmak için boş/yabancı
  bölgeden sürükle veya sağ tuşu kullan.
- **Saldırı:** Alttaki çubukla gücünün yüzde kaçını göndereceğini seç (klavye: 1=%10,
  2=%25, 3=%50, 4=%100), sonra hedefe tıkla → ⚔️ (kara) / ⛵ (deniz) menüsü açılır.
- **Gemiler:** ⛵ seçersen piksel yelkenli en kısa su yolunu bulup hedef kıyıya gider
  (%3.125 gemi vergisi). Yolda her pikselde asker erir — asker biterse **gemi batar**,
  hedefe ulaşamaz. Uzak seferlere az askerle çıkma!
- **Saldırı yönetimi:** Devam eden saldırıların güç barının üstünde listelenir;
  ✕ ile saldırıyı iptal et (askerler eve döner), ↩ ile yoldaki gemiyi geri çağır
  (dönüş yolunda da erime işler).
- **Kamera:** Fareyle sürükle = kaydır, tekerlek = yakınlaştır.
- **Ekonomi:** Gücün her 5.6 saniyede bir faiz getirir. Güç barın kırmızıya dönerse
  (arazi × 100 sınırı) daha fazla gelir için toprak alman gerekir. Savunma saldırıdan
  2 kat güçlüdür — zamanlamanı iyi seç.
- **Hedef:** Ana karanın %60'ını ele geçir.

## Dosyalar

- `js/config.js` — tüm denge ayarları (hız, faiz, maliyetler)
- `js/mapgen.js` — prosedürel harita üretimi (her oyunda yeni kıta)
- `js/game.js` — çekirdek mantık: sahiplik, ekonomi, saldırı/yayılma
- `js/render.js` — çizim ve kamera
- `js/bots.js` — bot yapay zekası
- `js/main.js` — oyun döngüsü, girişler, arayüz
- `GAME_DESIGN.md` — tasarım belgesi ve yol haritası

## Yol haritası

Aşama 2: binalar (şehir/savunma kulesi), yönlendirilmiş ordu saldırısı, gemiler.
Aşama 3: çoklu harita (gerçek dünya haritası dahil). Aşama 4: çevrimiçi multiplayer.
