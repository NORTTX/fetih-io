# Fetih Oyunu — Tasarım Belgesi

Territorial.io mantığını temel alan, üstüne bina ve yönlendirilmiş ordu mekanikleri eklenen
çevrimiçi fetih oyunu.

## 1. Territorial.io Çekirdek Mekanikleri (birebir alacağımız temel)

### 1.1 Harita
- Harita bir piksel ızgarasıdır. Her hücre: su / boş kara / bir oyuncuya ait.
- Oyuncunun "score"u (puanı) = sahip olduğu piksel sayısı.

### 1.2 Zaman Sistemi
- 1 tick = 560 ms, 1 döngü (cycle) = 10 tick = 5.6 saniye.
- Faiz geliri her döngü sonunda (10. tick) dağıtılır.

### 1.3 Denge (Balance) ve Ekonomi
- Tek kaynak: denge (asker sayısı). Hem para hem ordu hem savunma gücü.
- Faiz oranı %7.00'den başlar, her tick azalır; arazi büyüklüğüne (score) bağlıdır.
- Maksimum denge = 150 × piksel sayısı.
- Maksimum faiz geliri, denge = 100 × piksel sayısı olduğunda alınır.
  Bu eşiğin üstünde denge kırmızıya döner → daha fazla gelir için arazi genişletmek şart.
- Askerler "evdeyken" gelir üretir; saldırıya gönderilen asker gelir üretmez.
- Ekonomi bileşik büyür: küçük bir denge avantajı zamanla katlanarak büyür.

### 1.4 Saldırı Mekaniği
- Oyuncu yüzde çubuğuyla dengesinin ne kadarını saldırıya ayıracağını seçer
  (%5-15 zayıf hedef, %20 standart, %50 boş arazi, %100 tam gönderim).
- Saldırı maliyeti (vergi): dengenin %1.17'si (12/1024).
- Savunma 2 kat güçlüdür: x askerle saldırılan savunmacı yaklaşık x/2 asker kaybeder.
  Fethetmek için saldırı gücü savunmanın 2 katı olmalı.
- Fetih, sınır piksellerinden dalga dalga yayılır (flood-fill benzeri).
  Sınır saldırısı en az bir "katman" piksel almak zorundadır.
- Yayılma hızı score ile artar (piksel/saniye):
  0 → 5.85 | 10k → 8.5 | 30k → 10.2 | 60k → 18.5 | 90k → 19.5 | 160k → 35 | 300k+ → 65

### 1.5 Deniz / Gemiler
- Gemi üretmek: dengenin %3.125'i (32/1024). Gemi taşıma: %0.78 (8/1024).
- Gemiler su üzerinden kıyıya asker çıkarır; yolculukta asker kaybı olur.
- Çıkarma noktası çevresinde yoğunlaşmış yayılma sağlar.

### 1.6 Diğer
- Müttefik desteği: dengenin %6.25'i + zamanla azalan ek vergi.
- Botlar: başta yavaş genişler, orta oyunda saldırganlaşır.
- Terk edilmiş oyuncular bota dönüşür.

## 2. Bizim Eklemelerimiz

### 2.1 Binalar ✅ (uygulandı)
- 🏙️ Şehir: gelir +%10/şehir, güç tavanına +1500 sanal piksel. 2000'den, her yenisi 2x.
- 🗼 Kule: 22px yarıçapta savunma ekstra 2x (saldıran 4x öder). 2500'den, ×1.6.
- ⚓ Liman: gemi vergisi + erime her limanla ×0.8 (min ×0.4). Kıyı şartı. 3000'den, ×1.5.
- Kurallar: kendi toprağına tıkla → inşa menüsü; binalar arası min 8px;
  binalar yıkılmaz, pikselini fetheden ELE GEÇİRİR. Botlar da inşa eder.

Haritalar ✅: Dünya (110m), Avrupa + Akdeniz (Natural Earth 50m),
Takımada + İki Kıta + Kıta (prosedürel şablonlar).

### (eski taslak) Binalar
- Oyuncu kendi arazisindeki bir noktaya denge harcayarak bina kurar.
- İlk bina fikirleri (ayarlanacak):
  - **Şehir**: kurulduğu bölgenin gelir çarpanını artırır (daha hızlı güç kasma).
  - **Savunma kulesi**: çevresindeki sınır piksellerinde savunma bonusu.
  - **Liman**: gemi maliyetini düşürür / ticaret geliri.
- Denge unsuru: bina maliyeti + geri dönüş süresi, "bina kasan" ile "erken saldıran"
  arasında taş-kağıt-makas dengesi kuracak şekilde ayarlanmalı.
- (OpenFront.io benzer sistemi kanıtladı: şehir, liman, savunma, füze silosu.)

### 2.2 Yönlendirilmiş Ordu / Hedefli Yayılma ✅ (uygulandı — kendi toprağından
hedefe sürükle-bırak; cephe pikselleri arasından hedefe en yakın 12 aday örneklenip
seçilir, saldırı hedefe koridor açarak ilerler. Takım modu da eklendi: 2/3/4 takım,
müttefiğe saldırı engelli, takım renk paleti ortak.)
- Territorial'de saldırı, o komşuyla olan TÜM sınırdan yayılır.
- Bizde ek olarak: oyuncu haritada bir hedef nokta/bölge seçebilir,
  yayılma o hedefe doğru öncelikli/yoğunlaşmış ilerler (ordu emri hissi).
- Uygulama fikri: hedef noktaya uzaklığa göre ağırlıklandırılmış flood-fill —
  hedefe yakın sınır pikselleri önce fethedilir; isteğe bağlı yayılma koridoru genişliği.
- Klasik "tüm sınırdan yayıl" modu da kalır (iki mod birlikte).

## 3. Yol Haritası (güncel: önce Territorial işlevselliği, özgün içerik en sona)
1. **Aşama 1** ✅: Tek oyunculu + botlar. Piksel harita, ekonomi, saldırı/yayılma.
2. **Aşama 2** (Territorial eşitliği):
   - ✅ Gemiler / deniz saldırıları (bot kolonizasyonu dahil)
   - ✅ ⚔️/⛵ saldırı seçim menüsü; piksel yelkenli sprite; yolda erime + batma
     (BOAT_ATTRITION: her pikselde başlangıç askerinin %0.07'si; 0 → gemi batar)
   - ✅ Gelir döngüsü göstergesi + devam eden saldırı listesi
   - ✅ Gerçek dünya haritası (Natural Earth 110m verisi, 1200x600) + harita seçimi
   - ✅ Diplomasi: barış paktı (🤝 teklif / bot teklifleri), ihanet (🗡️ pakt bozma →
     TRAITOR_CYCLES boyunca kimse pakt yapmaz), bot-bot paktları, fırsatçı bot ihaneti
   - ✅ Yönlü saldırı dengesi: DIRECTED_COST_MULT = 1.2 (okla saldırı piksel başına
     1.2 kat asker; savunan kaybı temel maliyetten)
   - ⬜ Bot kişilikleri ve daha akıllı hedef seçimi
3. **Aşama 3**: Çevrimiçi multiplayer (Node.js + WebSocket).
4. **Aşama 4** (özgün içerik): Binalar (şehir/savunma kulesi) +
   yönlendirilmiş ordu emri (hedefe yoğunlaşan yayılma).

## 4. Referanslar
- Resmi eğitim: https://territorial.io/tutorial
- Mekanik rehberi: https://www.tyefender.com/territorial-io-ultimate-guide/
- Wiki: https://territorial.fandom.com/wiki/Attacks
- OpenFront.io (açık kaynak benzer oyun, AGPL): https://github.com/openfrontio/OpenFrontIO
  Not: Kod kopyalanmayacak (AGPL lisans bulaşır), sadece mekanik/fikir referansı.
