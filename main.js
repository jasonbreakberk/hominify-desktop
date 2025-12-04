const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const fs = require('fs');
const ytdl = require('ytdl-core');
const ytsr = require('ytsr');
const http = require('http');
const { URL } = require('url');

const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const ytdlpExec = require('yt-dlp-exec');

const ytDlp = ytdl;

let mainWindow;

// Uygulama data dizini
const userDataPath = app.getPath('userData');
const downloadsPath = path.join(userDataPath, 'downloads');

// Basit yerel ses proxy sunucusu
let audioServer = null;
let audioPort = null;

async function ensureAudioServer() {
  if (audioServer && audioPort) return audioPort;

  audioServer = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, 'http://127.0.0.1');
      if (urlObj.pathname === '/stream') {
        const videoId = urlObj.searchParams.get('videoId');
        if (!videoId) {
          res.writeHead(400);
          res.end('videoId gerekli');
          return;
        }
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        try {
          console.log(`[Main] Stream başlatılıyor: ${videoId}`);
          
          if (res.destroyed) {
            console.warn('[Main] Response zaten destroyed');
            return;
          }

          const videoUrlLocal = `https://www.youtube.com/watch?v=${videoId}`;
          
          // Response header'ını hemen gönder
          if (!res.destroyed) {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-store',
              'Accept-Ranges': 'bytes',
              'Connection': 'keep-alive',
              'Transfer-Encoding': 'chunked'
            });
          }

          console.log(`[Main] ytdl-core ile stream başlatılıyor ve ffmpeg ile mp3'e dönüştürülüyor: ${videoId}`);

          const ytdlStream = ytdl(videoUrlLocal, {
            quality: 'highestaudio',
            filter: 'audioonly',
            highWaterMark: 1 << 25
          });

          const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-i', 'pipe:0',
            '-f', 'mp3',
            '-ab', '192k',
            '-ar', '44100',
            '-ac', '2',
            'pipe:1'
          ], { stdio: ['pipe', 'pipe', 'pipe'] });

          // İlk tercihle yt-dlp binary'sinden ham audio alıp ffmpeg'e veriyoruz
          let ytdlpProc;
          try {
            ytdlpProc = ytdlpExec.exec(videoUrlLocal, { f: 'bestaudio[ext=m4a]/bestaudio', o: '-', 'no-playlist': true }, { stdio: ['ignore', 'pipe', 'pipe'] });
          } catch (e) {
            console.error(`[Main] yt-dlp spawn hatası (${videoId}):`, e.message);
            if (!res.destroyed) { res.writeHead(500); res.end('yt-dlp başlatılamadı'); }
            return;
          }

          ytdlpProc.stdout.pipe(ffmpeg.stdin);

          let started = false;
          ffmpeg.stdout.on('data', (chunk) => {
            if (!started) {
              started = true;
              console.log(`[Main] ffmpeg stdout akmaya başladı: ${videoId} (chunk ${chunk.length})`);
            }
          });

          ffmpeg.on('error', (e) => {
            console.error(`[Main] ffmpeg hata (${videoId}):`, e.message);
            if (!res.destroyed) try { res.destroy(e); } catch(_) {}
          });

          ytdlpProc.on('error', (e) => {
            console.error(`[Main] yt-dlp hata (${videoId}):`, e.message);
            if (!res.destroyed) try { res.destroy(e); } catch(_) {}
          });

          ytdlpProc.stderr.on('data', (d) => {
            console.error(`[Main] yt-dlp stderr: ${d.toString()}`);
          });

          ffmpeg.stderr.on('data', (d) => {
            console.error(`[Main] ffmpeg stderr: ${d.toString()}`);
          });

          res.on('error', () => {
            console.warn(`[Main] Response hatası (${videoId})`);
            try { ffmpeg.kill('SIGKILL'); } catch(_) {}
            try { ytdlpProc.kill('SIGKILL'); } catch(_) {}
          });

          res.on('close', () => {
            console.log(`[Main] Response kapalı: ${videoId}`);
            try { ffmpeg.kill('SIGKILL'); } catch(_) {}
            try { ytdlpProc.kill('SIGKILL'); } catch(_) {}
          });

          ffmpeg.stdout.pipe(res);
          console.log(`[Main] Stream pipe (ffmpeg->res) başladı: ${videoId}`);
        } catch (ytError) {
          console.error('[Main] YouTube stream başlatma hatası:', ytError.message);
          if (!res.destroyed) {
            res.writeHead(500);
            res.end('Stream başlatılamadı');
          }
        }
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (e) {
      console.error('[Main] Proxy hatası:', e.message);
      try {
        res.writeHead(500);
        res.end('Sunucu hatası');
      } catch (_) {}
    }
  });

  await new Promise((resolve, reject) => {
    audioServer.on('error', reject);
    audioServer.listen(0, '127.0.0.1', () => {
      audioPort = audioServer.address().port;
      console.log(`[Main] Audio proxy portu: ${audioPort}`);
      resolve();
    });
  });

  return audioPort;
}

// Downloads klasörünü oluştur
if (!fs.existsSync(downloadsPath)) {
  fs.mkdirSync(downloadsPath, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#121212',
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // DevTools otomatik açılmıyor

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// YouTube'dan video arama
ipcMain.handle('youtube:search', async (event, query) => {
  try {
    console.log(`[Main] YouTube arama: ${query}`);
    const searchResults = await ytsr(query, { limit: 10 });

    if (searchResults.items && searchResults.items.length > 0) {
      const firstVideo = searchResults.items.find(item => item.type === 'video');
      if (firstVideo) {
        const id = firstVideo.id || (firstVideo.url ? new URL(firstVideo.url).searchParams.get('v') : null);
        console.log(`[Main] Video bulundu: ${id}`);
        return id;
      }
    }

    console.warn(`[Main] Video bulunamadı: ${query}`);
    return null;
  } catch (error) {
    console.error('[Main] YouTube arama hatası:', error);
    return null;
  }
});

// YouTube'dan ses URL'si al
ipcMain.handle('youtube:get-audio-url', async (event, videoId) => {
  try {
    console.log(`[Main] Audio stream hazırlanıyor: ${videoId}`);
    const port = await ensureAudioServer();
    const localUrl = `http://127.0.0.1:${port}/stream?videoId=${encodeURIComponent(videoId)}`;
    return localUrl;
  } catch (error) {
    console.error('[Main] Audio stream hatası:', error?.stack || error?.message || error);
    return null;
  }
});

// Şarkı indirme
ipcMain.handle('youtube:download', async (event, { videoId, title, artist }) => {
  try {
    console.log(`[Main] İndiriliyor: ${title} - ${artist}`);
    
    const sanitizedTitle = `${title} - ${artist}`.replace(/[/\\?%*:|"<>]/g, '-');
    const filePath = path.join(downloadsPath, `${sanitizedTitle}.mp3`);
    
    // Zaten indirilmiş mi kontrol et
    if (fs.existsSync(filePath)) {
      console.log(`[Main] Dosya zaten mevcut: ${filePath}`);
      return { success: true, path: filePath, cached: true };
    }
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      console.log('[Main] yt-dlp ile indirilmeye başlanıyor:', videoId);
      // yt-dlp'yi doğrudan mp3'e dönüştürerek dosyaya yazıyoruz
      await ytdlpExec.exec(videoUrl, { x: true, 'audio-format': 'mp3', o: filePath, 'no-playlist': true });
      console.log(`[Main] İndirme tamamlandı: ${filePath}`);
      return { success: true, path: filePath, cached: false };
    } catch (err) {
      console.error('[Main] yt-dlp indirme hatası:', err);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
      return { success: false, error: err.message || String(err) };
    }
  } catch (error) {
    console.error('[Main] İndirme başlatma hatası:', error);
    return { success: false, error: error.message };
  }
});

// İndirilen şarkıları listele
ipcMain.handle('offline:list', async () => {
  try {
    const files = fs.readdirSync(downloadsPath);
    const mp3Files = files.filter(file => file.endsWith('.mp3'));
    
    return mp3Files.map(file => {
      const fullPath = path.join(downloadsPath, file);
      const stats = fs.statSync(fullPath);
      
      return {
        name: file.replace('.mp3', ''),
        path: fullPath,
        size: stats.size,
        createdAt: stats.birthtime
      };
    });
  } catch (error) {
    console.error('[Main] Offline liste hatası:', error);
    return [];
  }
});

// Offline şarkı silme
ipcMain.handle('offline:delete', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Main] Dosya silindi: ${filePath}`);
      return { success: true };
    }
    return { success: false, error: 'Dosya bulunamadı' };
  } catch (error) {
    console.error('[Main] Silme hatası:', error);
    return { success: false, error: error.message };
  }
});

// Uygulama hazır olduğunda
app.whenReady().then(createWindow);

// Tüm pencereler kapatıldığında
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Uygulama aktif hale geldiğinde
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

console.log('[Main] Hominify başlatıldı');
console.log(`[Main] İndirmeler dizini: ${downloadsPath}`);