# 🎵 Hominify Desktop

Spotify entegrasyonlu masaüstü müzik uygulaması.

![Electron](https://img.shields.io/badge/Electron-191970?style=for-the-badge&logo=Electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Spotify](https://img.shields.io/badge/Spotify-1ED760?style=for-the-badge&logo=spotify&logoColor=white)

## ✨ Özellikler

- 🎧 **Spotify Entegrasyonu** - Beğenilen şarkılar ve çalma listeleri
- 🎬 **YouTube Streaming** - Şarkıları YouTube'dan dinle
- 💾 **Otomatik İndirme** - Şarkılar arka planda indirilir, sonraki seferlerde anında açılır
- 🎤 **Şarkı Sözleri** - Gerçek zamanlı lyrics görüntüleme
- 🎨 **Modern Arayüz** - Spotify benzeri tasarım, animasyonlu arka plan
- 📋 **Queue Panel** - Sıradaki şarkıları görüntüle
- 🔀 **Shuffle & Repeat** - Karıştırma ve tekrar modları
- ⚙️ **Ayarlar** - Tema, dil ve indirme ayarları

## 🚀 Kurulum

```bash
# Repoyu klonla
git clone https://github.com/jasonbreakberk/hominify-desktop.git

# Dizine git
cd hominify-desktop

# Bağımlılıkları yükle
npm install

# Uygulamayı başlat
npm start
```

## ⚙️ Spotify Kurulumu

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)'a git
2. Yeni bir uygulama oluştur
3. `.env` dosyası oluştur:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

4. Redirect URI olarak `http://localhost:8888/callback` ekle

## 📁 Proje Yapısı

```
hominify/
├── main.js          # Electron ana işlemi
├── renderer.js      # Renderer işlemi
├── index.html       # Ana arayüz
├── package.json     # Bağımlılıklar
└── .env             # API anahtarları
```

## 🎮 Kullanım

1. Uygulamayı başlat
2. Spotify ile giriş yap
3. Beğenilen şarkılarını ve çalma listelerini gör
4. Şarkıya tıkla ve dinle!

## 📝 Lisans

MIT License

## 👨‍💻 Geliştirici

Hominify Team
