const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const axios = require('axios');
const ytdl = require('ytdl-core');
const os = require('os');
require('dotenv').config();

// Uygulama durumu
const appState = {
  isPlaying: false,
  currentTrack: null,
  audioElement: new Audio(),
  theme: 'dark',
  language: 'tr',
  volume: 0.7,
  currentTime: 0,
  duration: 0,
  queue: [],
  currentTrackIndex: -1,
  spotifyAccessToken: null,
  spotifyRefreshToken: null,
  spotifyTokenExpiresAt: null,
  likedTracks: [],
  playlists: [],
  audioServer: null,
  audioServerPort: null,
  spotifyUser: null
};

// DOM elementleri
const elements = {
  // Çalma kontrolleri
  playPauseBtn: document.querySelector('.play-pause'),
  prevBtn: document.querySelector('.fa-step-backward').parentElement,
  nextBtn: document.querySelector('.fa-step-forward').parentElement,
  shuffleBtn: document.querySelector('.fa-random').parentElement,
  repeatBtn: document.querySelector('.fa-redo').parentElement,
  
  // Şarkı bilgileri
  nowPlayingImg: document.querySelector('.now-playing-img'),
  songTitle: document.querySelector('.song-title'),
  songArtist: document.querySelector('.song-artist'),
  likeBtn: document.querySelector('.fa-heart').parentElement,
  
  // İlerleme çubuğu
  progressBar: document.querySelector('.progress-bar'),
  progress: document.querySelector('.progress'),
  currentTimeEl: document.querySelector('.time:first-child'),
  totalTimeEl: document.querySelector('.time:last-child'),
  
  // Ses kontrolü
  volumeBtn: document.querySelector('.fa-volume-up').parentElement,
  volumeSlider: document.querySelector('.volume-slider'),
  
  // Arama çubuğu
  searchInput: document.querySelector('.search-bar input'),
  
  // Spotify
  spotifyLoginBtn: document.querySelector('.spotify-login-btn'),
  spotifyLoginText: document.querySelector('.spotify-login-text'),
  downloadBtn: document.querySelector('.download-btn'),
  userAvatar: document.querySelector('.user-avatar'),
  
  // Kitaplık & gridler
  libraryList: document.getElementById('library-list'),
  likedGrid: document.getElementById('liked-tracks'),
  playlistsGrid: document.getElementById('playlists-grid'),
  mainSectionTitle: document.querySelector('.section .section-title'),
  
  // Ana içerik alanı
  cards: document.querySelectorAll('.card')
};

// Tema değiştirme
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  appState.theme = theme;
  localStorage.setItem('hominify-theme', theme);
}

// Dil değiştirme
function setLanguage(lang) {
  appState.language = lang;
  localStorage.setItem('hominify-lang', lang);
  updateUITexts();
}

// Arayüz metinlerini güncelle
function updateUITexts() {
  const texts = {
    tr: {
      theme: 'Tema Seçin',
      language: 'Dil Seçin',
      start: 'Başlat',
      welcome: 'Hoş Geldiniz',
      loading: 'Yükleniyor...'
    },
    en: {
      theme: 'Select Theme',
      language: 'Select Language',
      start: 'Start',
      welcome: 'Welcome',
      loading: 'Loading...'
    }
  };

  const currentLang = appState.language;
  const t = texts[currentLang] || texts.tr;

  // Başlıkları güncelle
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) {
      el.textContent = t[key];
    }
  });

  // Buton metnini güncelle
  if (elements.startButton) {
    elements.startButton.textContent = t.start;
  }
}

function getSpotifyHeaders() {
  return {
    Authorization: `Bearer ${appState.spotifyAccessToken}`,
    'Content-Type': 'application/json'
  };
}

function mapSpotifyTrack(track) {
  if (!track) return null;
  const image =
    track.album &&
    Array.isArray(track.album.images) &&
    track.album.images.length > 0
      ? track.album.images[0].url
      : '';
  const artists = (track.artists || []).map(a => a.name).join(', ');

  return {
    id: track.id,
    title: track.name,
    artist: artists,
    image,
    previewUrl: track.preview_url || null,
    spotifyUri: track.uri
  };
}

function mapSpotifyPlaylist(playlist) {
  if (!playlist) return null;
  const image =
    Array.isArray(playlist.images) && playlist.images.length > 0
      ? playlist.images[0].url
      : '';

  return {
    id: playlist.id,
    name: playlist.name,
    image,
    tracksTotal: playlist.tracks?.total || 0
  };
}

async function fetchSpotifyLikedTracks() {
  if (!appState.spotifyAccessToken) return [];

  try {
    const res = await axios.get('https://api.spotify.com/v1/me/tracks', {
      headers: getSpotifyHeaders(),
      params: {
        limit: 50
      }
    });

    const items = res.data.items || [];
    appState.likedTracks = items
      .filter(item => item && item.track)
      .map(item => mapSpotifyTrack(item.track))
      .filter(Boolean);

    renderLikedTracks();
    return appState.likedTracks;
  } catch (err) {
    console.error('Spotify liked tracks error:', err.response?.data || err);
    return [];
  }
}

async function fetchSpotifyPlaylists() {
  if (!appState.spotifyAccessToken) return [];

  try {
    const res = await axios.get('https://api.spotify.com/v1/me/playlists', {
      headers: getSpotifyHeaders(),
      params: {
        limit: 20
      }
    });

    const items = res.data.items || [];
    appState.playlists = items.map(p => mapSpotifyPlaylist(p)).filter(Boolean);

    renderPlaylistsGrid();
    renderLibrarySidebar();
    return appState.playlists;
  } catch (err) {
    console.error('Spotify playlists error:', err.response?.data || err);
    return [];
  }
}

async function fetchSpotifyPlaylistTracks(playlistId, playlistName) {
  if (!appState.spotifyAccessToken || !playlistId) return [];

  try {
    const res = await axios.get(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      {
        headers: getSpotifyHeaders(),
        params: {
          limit: 50
        }
      }
    );

    const items = res.data.items || [];
    const tracks = items
      .filter(item => item && item.track)
      .map(item => mapSpotifyTrack(item.track))
      .filter(Boolean);

    if (elements.likedGrid) {
      renderTrackListToGrid(tracks, elements.likedGrid, playlistName || 'Çalma Listesi');
    }

    return tracks;
  } catch (err) {
    console.error('Spotify playlist tracks error:', err.response?.data || err);
    return [];
  }
}

function renderTrackListToGrid(tracks, gridEl, title) {
  if (!gridEl) return;

  gridEl.innerHTML = '';

  if (title && elements.mainSectionTitle) {
    elements.mainSectionTitle.textContent = title;
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = '#b3b3b3';
    empty.style.fontSize = '14px';
    empty.textContent = 'Burada gösterilecek şarkı yok.';
    gridEl.appendChild(empty);
    appState.queue = [];
    return;
  }

  appState.queue = tracks.slice();

  tracks.forEach((track, index) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = String(index);

    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = track.image || '';
    card.appendChild(img);

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-title';
    titleEl.textContent = track.title;
    card.appendChild(titleEl);

    const artistEl = document.createElement('p');
    artistEl.className = 'card-text';
    artistEl.textContent = track.artist;
    card.appendChild(artistEl);

    card.addEventListener('click', () => {
      playTrackAtIndex(index);
    });

    gridEl.appendChild(card);
  });
}

function renderLikedTracks() {
  if (!elements.likedGrid) return;
  renderTrackListToGrid(appState.likedTracks, elements.likedGrid, 'Beğenilen Şarkılar');
}

function renderPlaylistsGrid() {
  if (!elements.playlistsGrid) return;

  const grid = elements.playlistsGrid;
  grid.innerHTML = '';

  if (!Array.isArray(appState.playlists) || appState.playlists.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = '#b3b3b3';
    empty.style.fontSize = '14px';
    empty.textContent = 'Henüz çalma listen bulunmuyor.';
    grid.appendChild(empty);
    return;
  }

  appState.playlists.forEach(playlist => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.playlistId = playlist.id;

    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = playlist.image || '';
    card.appendChild(img);

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-title';
    titleEl.textContent = playlist.name;
    card.appendChild(titleEl);

    const textEl = document.createElement('p');
    textEl.className = 'card-text';
    textEl.textContent = `${playlist.tracksTotal} şarkı`;
    card.appendChild(textEl);

    card.addEventListener('click', () => {
      fetchSpotifyPlaylistTracks(playlist.id, playlist.name);
    });

    grid.appendChild(card);
  });
}

function renderLibrarySidebar() {
  if (!elements.libraryList) return;

  const container = elements.libraryList;
  container.innerHTML = '';

  const title = document.createElement('h3');
  title.textContent = 'Kitaplığın';
  container.appendChild(title);

  const createItem = (iconClass, label, onClick) => {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'nav-item';

    const icon = document.createElement('i');
    icon.className = iconClass;
    a.appendChild(icon);

    const span = document.createElement('span');
    span.textContent = label;
    a.appendChild(span);

    a.addEventListener('click', e => {
      e.preventDefault();
      container.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
      a.classList.add('active');
      if (onClick) onClick();
    });

    container.appendChild(a);
  };

  createItem('fas fa-heart', `Beğenilen Şarkılar (${appState.likedTracks.length})`, () => {
    renderLikedTracks();
  });

  appState.playlists.forEach(playlist => {
    createItem('fas fa-music', playlist.name, () => {
      fetchSpotifyPlaylistTracks(playlist.id, playlist.name);
    });
  });
}

async function loadSpotifyLibrary() {
  if (!appState.spotifyAccessToken) return;
  await fetchSpotifyLikedTracks();
  await fetchSpotifyPlaylists();
  await fetchSpotifyUserProfile();
}

async function fetchSpotifyUserProfile() {
  if (!appState.spotifyAccessToken) return;

  try {
    const res = await axios.get('https://api.spotify.com/v1/me', {
      headers: getSpotifyHeaders()
    });

    appState.spotifyUser = res.data;
    updateUserAvatar();
  } catch (err) {
    console.error('Spotify user profile error:', err.response?.data || err);
  }
}

function updateUserAvatar() {
  if (!elements.userAvatar) return;

  const user = appState.spotifyUser;
  if (!user) {
    elements.userAvatar.textContent = 'K';
    elements.userAvatar.style.backgroundImage = '';
    return;
  }

  const name = user.display_name || user.id || 'K';
  const first = name.charAt(0).toUpperCase();
  elements.userAvatar.textContent = first;

  const images = user.images || [];
  if (images.length && images[0].url) {
    elements.userAvatar.style.backgroundImage = `url(${images[0].url})`;
    elements.userAvatar.style.backgroundSize = 'cover';
    elements.userAvatar.style.backgroundPosition = 'center';
  }

  initUserMenu();
}

let userMenuEl = null;

function initUserMenu() {
  if (!elements.userAvatar) return;
  if (userMenuEl) return; // bir kere oluştur

  userMenuEl = document.createElement('div');
  userMenuEl.className = 'user-menu-popup';
  userMenuEl.style.position = 'absolute';
  userMenuEl.style.right = '24px';
  userMenuEl.style.top = '56px';
  userMenuEl.style.background = '#181818';
  userMenuEl.style.border = '1px solid #282828';
  userMenuEl.style.borderRadius = '8px';
  userMenuEl.style.padding = '8px 0';
  userMenuEl.style.minWidth = '180px';
  userMenuEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
  userMenuEl.style.display = 'none';
  userMenuEl.style.zIndex = '1000';

  const makeItem = (label, action) => {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.padding = '8px 16px';
    item.style.fontSize = '14px';
    item.style.cursor = 'pointer';

    item.addEventListener('mouseenter', () => {
      item.style.background = '#282828';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });

    if (action === 'logout') {
      item.style.color = '#ff5555';
    }

    item.addEventListener('click', () => {
      if (action === 'logout') {
        handleLogout();
      }
      userMenuEl.style.display = 'none';
    });

    userMenuEl.appendChild(item);
  };

  makeItem('Profil', 'profile');
  makeItem('Ayarlar', 'settings');
  makeItem('Oturumu kapat', 'logout');

  document.body.appendChild(userMenuEl);

  elements.userAvatar.addEventListener('click', () => {
    if (!userMenuEl) return;
    userMenuEl.style.display = userMenuEl.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', e => {
    if (!userMenuEl || !elements.userAvatar) return;
    if (e.target === elements.userAvatar || elements.userAvatar.contains(e.target)) return;
    if (userMenuEl.contains(e.target)) return;
    userMenuEl.style.display = 'none';
  });
}

function handleLogout() {
  appState.spotifyAccessToken = null;
  appState.spotifyRefreshToken = null;
  appState.spotifyTokenExpiresAt = null;
  appState.likedTracks = [];
  appState.playlists = [];
  appState.spotifyUser = null;

  localStorage.removeItem('hominify-spotify');

  if (elements.likedGrid) elements.likedGrid.innerHTML = '';
  if (elements.playlistsGrid) elements.playlistsGrid.innerHTML = '';
  if (elements.libraryList) elements.libraryList.innerHTML = '';

  updateSpotifyButton();
}

function updatePlayerUI(track) {
  if (!track) return;

  if (elements.songTitle) elements.songTitle.textContent = track.title;
  if (elements.songArtist) elements.songArtist.textContent = track.artist;
  if (elements.nowPlayingImg && track.image) {
    elements.nowPlayingImg.src = track.image;
  }
}

function updatePlayPauseButton() {
  if (!elements.playPauseBtn) return;
  const icon = elements.playPauseBtn.querySelector('i');
  if (!icon) return;

  if (appState.isPlaying) {
    icon.classList.remove('fa-play');
    icon.classList.add('fa-pause');
  } else {
    icon.classList.remove('fa-pause');
    icon.classList.add('fa-play');
  }
}

async function getYoutubeAudioUrl(videoId) {
  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });
    return format?.url || null;
  } catch (err) {
    console.error('YouTube audio url error:', err);
    return null;
  }
}

async function fallbackYoutubeSearch(query) {
  try {
    const res = await axios.get('https://www.youtube.com/results', {
      params: { search_query: query },
      headers: {
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 Hominify'
      }
    });

    const html = res.data;
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!match) return null;
    return match[1];
  } catch (err) {
    console.error('YouTube fallback search error:', err);
    return null;
  }
}

async function searchYoutubeForTrack(track) {
  const query = `${track.title} ${track.artist}`;

  // Önce YouTube Data API'yi dene
  try {
    if (process.env.YOUTUBE_API_KEY) {
      const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          q: query,
          maxResults: 1,
          type: 'video',
          key: process.env.YOUTUBE_API_KEY
        }
      });

      const items = res.data.items || [];
      if (items.length) {
        const videoId = items[0].id.videoId;
        track.youtubeId = videoId;
        return await getYoutubeAudioUrl(videoId);
      }
    }
  } catch (err) {
    console.error('YouTube API search error:', err.response?.data || err);
  }

  // API başarısızsa HTML fallback kullan
  const fallbackId = await fallbackYoutubeSearch(query);
  if (!fallbackId) return null;
  track.youtubeId = fallbackId;
  return await getYoutubeAudioUrl(fallbackId);
}

async function resolveTrackAudioUrl(track) {
  if (track.previewUrl) return track.previewUrl;

  if (track.youtubeAudioUrl) return track.youtubeAudioUrl;

  if (track.youtubeId) {
    const url = await getYoutubeAudioUrl(track.youtubeId);
    track.youtubeAudioUrl = url;
    return url;
  }

  const url = await searchYoutubeForTrack(track);
  track.youtubeAudioUrl = url;
  return url;
}

async function playTrack(track) {
  if (!track) return;

  appState.currentTrack = track;
  updatePlayerUI(track);

  const audioUrl = await resolveTrackAudioUrl(track);
  if (!audioUrl) {
    console.error('Bu şarkı için ses kaynağı bulunamadı');
    return;
  }

  try {
    appState.audioElement.src = audioUrl;
    appState.audioElement.volume = appState.volume;
    await appState.audioElement.play();
    appState.isPlaying = true;
    updatePlayPauseButton();
  } catch (err) {
    console.error('Şarkı çalınamadı:', err);
  }
}

function playTrackAtIndex(index) {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) return;
  if (index < 0 || index >= appState.queue.length) return;
  appState.currentTrackIndex = index;
  const track = appState.queue[index];
  playTrack(track);
}

function togglePlayPause() {
  const audio = appState.audioElement;
  if (!audio || !audio.src) return;

  if (audio.paused) {
    audio.play();
    appState.isPlaying = true;
  } else {
    audio.pause();
    appState.isPlaying = false;
  }
  updatePlayPauseButton();
}

function formatTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateProgress() {
  const audio = appState.audioElement;
  if (!audio || !elements.progress) return;

  const { currentTime, duration } = audio;
  const percent = duration ? (currentTime / duration) * 100 : 0;

  elements.progress.style.width = `${percent}%`;

  if (elements.currentTimeEl) {
    elements.currentTimeEl.textContent = formatTime(currentTime);
  }
  if (elements.totalTimeEl) {
    elements.totalTimeEl.textContent = formatTime(duration);
  }
}

function seek(e) {
  const audio = appState.audioElement;
  if (!audio || !elements.progressBar) return;

  const rect = elements.progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = clickX / rect.width;
  if (audio.duration) {
    audio.currentTime = ratio * audio.duration;
  }
}

function setVolume(e) {
  const value = Number(e.target.value) / 100;
  appState.volume = value;
  appState.audioElement.volume = value;
}

function handleTrackEnded() {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) {
    appState.isPlaying = false;
    updatePlayPauseButton();
    return;
  }
  playNext();
}

function playNext() {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) return;
  let nextIndex = appState.currentTrackIndex + 1;
  if (nextIndex >= appState.queue.length) {
    nextIndex = 0;
  }
  playTrackAtIndex(nextIndex);
}

function playPrev() {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) return;
  let prevIndex = appState.currentTrackIndex - 1;
  if (prevIndex < 0) {
    prevIndex = appState.queue.length - 1;
  }
  playTrackAtIndex(prevIndex);
}

function shufflePlay() {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) return;
  const randomIndex = Math.floor(Math.random() * appState.queue.length);
  playTrackAtIndex(randomIndex);
}

function repeatCurrent() {
  if (appState.currentTrackIndex < 0) return;
  playTrackAtIndex(appState.currentTrackIndex);
}

async function downloadCurrentTrack() {
  const track = appState.currentTrack;
  if (!track) {
    console.error('İndirilecek aktif bir şarkı yok');
    return;
  }

  // İlgili YouTube kimliğini veya ses URL'sini çöz
  if (!track.youtubeId && !track.youtubeAudioUrl && !track.previewUrl) {
    await resolveTrackAudioUrl(track);
  }

  const videoId = track.youtubeId;
  if (!videoId) {
    console.error('Bu şarkı için YouTube kaynağı bulunamadı, indirilemiyor');
    return;
  }

  const downloadsDir = path.join(os.homedir(), 'HominifyDownloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const safeName = `${track.title} - ${track.artist}`.replace(/[<>:"/\\|?*]+/g, '_');
  const filePath = path.join(downloadsDir, `${safeName}.mp3`);

  try {
    const writeStream = fs.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
      ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
        filter: 'audioonly',
        quality: 'highestaudio'
      })
        .pipe(writeStream);

      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log('Şarkı indirildi:', filePath);
  } catch (err) {
    console.error('İndirme hatası:', err);
  }
}

async function searchYoutubeByQuery(query) {
  if (!query) return;

  try {
    let items = [];

    if (process.env.YOUTUBE_API_KEY) {
      const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          q: query,
          maxResults: 24,
          type: 'video',
          key: process.env.YOUTUBE_API_KEY
        }
      });
      items = res.data.items || [];
    }

    if (!items.length) {
      // API çalışmazsa HTML fallback kullan
      const fallbackId = await fallbackYoutubeSearch(query);
      if (!fallbackId) return;
      items = [
        {
          id: { videoId: fallbackId },
          snippet: {
            title: query,
            channelTitle: 'YouTube',
            thumbnails: { medium: { url: '' } }
          }
        }
      ];
    }

    const tracks = items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      image: item.snippet.thumbnails?.medium?.url || '',
      previewUrl: null,
      youtubeId: item.id.videoId
    }));

    if (elements.likedGrid) {
      renderTrackListToGrid(tracks, elements.likedGrid, `"${query}" araması`);
    }
  } catch (err) {
    console.error('YouTube search error:', err.response?.data || err);
  }
}

function handleSearchKey(e) {
  if (e.key === 'Enter') {
    const query = e.target.value.trim();
    searchYoutubeByQuery(query);
  }
}

function initPlayer() {
  const audio = appState.audioElement;
  if (!audio) return;

  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('ended', handleTrackEnded);

  if (elements.playPauseBtn) {
    elements.playPauseBtn.addEventListener('click', togglePlayPause);
  }
  if (elements.progressBar) {
    elements.progressBar.addEventListener('click', seek);
  }
  if (elements.volumeSlider) {
    elements.volumeSlider.addEventListener('input', setVolume);
  }

  if (elements.prevBtn) {
    elements.prevBtn.addEventListener('click', playPrev);
  }
  if (elements.nextBtn) {
    elements.nextBtn.addEventListener('click', playNext);
  }
  if (elements.shuffleBtn) {
    elements.shuffleBtn.addEventListener('click', shufflePlay);
  }
  if (elements.repeatBtn) {
    elements.repeatBtn.addEventListener('click', repeatCurrent);
  }
  if (elements.downloadBtn) {
    elements.downloadBtn.addEventListener('click', downloadCurrentTrack);
  }
}

function loadSpotifyFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem('hominify-spotify') || 'null');
    if (saved && saved.accessToken) {
      appState.spotifyAccessToken = saved.accessToken;
      appState.spotifyRefreshToken = saved.refreshToken || null;
      appState.spotifyTokenExpiresAt = saved.expiresAt || null;
    }
  } catch (err) {
    console.error('Spotify token parse error:', err);
  }
}

function saveSpotifyToStorage() {
  const data = {
    accessToken: appState.spotifyAccessToken,
    refreshToken: appState.spotifyRefreshToken,
    expiresAt: appState.spotifyTokenExpiresAt
  };
  localStorage.setItem('hominify-spotify', JSON.stringify(data));
}

function updateSpotifyButton() {
  if (!elements.spotifyLoginBtn) return;
  const connected = !!appState.spotifyAccessToken;
  const textEl = elements.spotifyLoginText;

  if (connected) {
    elements.spotifyLoginBtn.classList.add('connected');
    if (textEl) textEl.textContent = 'Spotify bağlı';
  } else {
    elements.spotifyLoginBtn.classList.remove('connected');
    if (textEl) textEl.textContent = 'Spotify ile giriş';
  }
}

function exchangeCodeForToken(code, redirectUri) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const postData = querystring.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  });

  const options = {
    hostname: 'accounts.spotify.com',
    port: 443,
    path: '/api/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || 'Spotify token error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function startSpotifyLogin() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('Spotify kimlik bilgileri eksik');
    return;
  }

  if (!elements.spotifyLoginBtn) return;

  const redirectUri = 'http://127.0.0.1:8888/callback';
  const scopes = [
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'playlist-read-private'
  ].join(' ');

  const authUrl = 'https://accounts.spotify.com/authorize' +
    `?client_id=${encodeURIComponent(process.env.SPOTIFY_CLIENT_ID)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}`;

  elements.spotifyLoginBtn.disabled = true;
  if (elements.spotifyLoginText) {
    elements.spotifyLoginText.textContent = 'Bağlanıyor...';
  }

  try {
    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const urlObj = new URL(req.url, redirectUri);
          if (urlObj.pathname === '/callback') {
            const authCode = urlObj.searchParams.get('code');
            const error = urlObj.searchParams.get('error');

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><p>Spotify girişi tamamlandı. Uygulamaya dönebilirsiniz.</p></body></html>');

            server.close();

            if (error) {
              return reject(new Error(error));
            }

            return resolve(authCode);
          }

          res.writeHead(404);
          res.end();
        } catch (e) {
          reject(e);
        }
      });

      server.listen(8888, () => {
        shell.openExternal(authUrl);
      });

      server.on('error', reject);
    });

    const tokens = await exchangeCodeForToken(code, redirectUri);

    appState.spotifyAccessToken = tokens.access_token;
    appState.spotifyRefreshToken = tokens.refresh_token || null;
    appState.spotifyTokenExpiresAt = Date.now() + (tokens.expires_in || 0) * 1000;

    saveSpotifyToStorage();
    await loadSpotifyLibrary();
  } catch (err) {
    console.error('Spotify login error:', err);
  } finally {
    elements.spotifyLoginBtn.disabled = false;
    updateSpotifyButton();
  }
}

// Uygulama başlatıldığında
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('hominify-theme') || 'dark';
  const savedLang = localStorage.getItem('hominify-lang') || 'tr';

  setTheme(savedTheme);
  setLanguage(savedLang);

  loadSpotifyFromStorage();
  updateSpotifyButton();

  initPlayer();

  if (appState.spotifyAccessToken) {
    loadSpotifyLibrary();
  }

  if (elements.spotifyLoginBtn) {
    elements.spotifyLoginBtn.addEventListener('click', startSpotifyLogin);
  }

  if (elements.searchInput) {
    elements.searchInput.addEventListener('keydown', handleSearchKey);
  }
});
