const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const axios = require('axios');
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
  spotifyUser: null,
  offlineTracks: [],
  currentVideoId: null
};

// DOM elementleri (güvenli seçimler)
const _prevIcon = document.querySelector('.fa-backward-step');
const _nextIcon = document.querySelector('.fa-forward-step');
const _shuffleIcon = document.querySelector('.fa-shuffle');
const _repeatIcon = document.querySelector('.fa-repeat');
const _likeIcon = document.querySelector('.fa-heart');
const _volumeIcon = document.querySelector('.fa-volume-high');

const elements = {
  // Çalma kontrolleri
  playPauseBtn: document.querySelector('.play-pause-btn') || document.querySelector('.play-pause'),
  prevBtn: document.getElementById('prev-btn') || (_prevIcon ? _prevIcon.parentElement : null),
  nextBtn: document.getElementById('next-btn') || (_nextIcon ? _nextIcon.parentElement : null),
  shuffleBtn: document.getElementById('shuffle-btn') || (_shuffleIcon ? _shuffleIcon.parentElement : null),
  repeatBtn: document.getElementById('repeat-btn') || (_repeatIcon ? _repeatIcon.parentElement : null),

  // Şarkı bilgileri
  nowPlayingImg: document.querySelector('.player-img') || document.querySelector('.now-playing-img'),
  songTitle: document.querySelector('.player-title') || document.querySelector('.song-title'),
  songArtist: document.querySelector('.player-artist') || document.querySelector('.song-artist'),
  likeBtn: _likeIcon ? _likeIcon.parentElement : null,

  // İlerleme çubuğu
  progressBar: document.getElementById('progress-bar') || document.querySelector('.progress-bar'),
  progress: document.getElementById('progress') || document.querySelector('.progress'),
  currentTimeEl: document.getElementById('current-time') || document.querySelector('.time:first-child'),
  totalTimeEl: document.getElementById('total-time') || document.querySelector('.time:last-child'),

  // Ses kontrolü
  volumeBtn: document.getElementById('volume-btn') || (_volumeIcon ? _volumeIcon.parentElement : null),
  volumeSlider: document.getElementById('volume-slider') || document.querySelector('.volume-slider'),

  // Arama çubuğu
  searchInput: document.querySelector('.search-bar input'),

  // Spotify
  spotifyLoginBtn: document.getElementById('spotify-login') || document.querySelector('.spotify-login-btn'),
  spotifyLoginText: document.querySelector('.spotify-login-text'),
  downloadBtn: document.getElementById('download-btn') || document.querySelector('.download-btn'),
  userAvatar: document.getElementById('user-avatar') || document.querySelector('.user-avatar'),

  // Kitaplık & gridler
  libraryList: document.getElementById('library-list'),
  likedGrid: document.getElementById('liked-tracks'),
  playlistsGrid: document.getElementById('playlists-grid'),
  mainSectionTitle: document.getElementById('main-section-title') || document.querySelector('.section .section-title'),

  // Sağ panel
  nowPlayingImgLarge: document.getElementById('now-playing-img-large'),
  nowPlayingTitleLarge: document.getElementById('now-playing-title-large'),
  nowPlayingArtistLarge: document.getElementById('now-playing-artist-large'),

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
    spotifyUri: track.uri,
    externalUrl: track.external_urls?.spotify || null
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

async function fetchSpotifyLikedTracks(isRetry = false) {
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
      .filter(Boolean); // Tüm şarkıları listele; preview yoksa YouTube'a düşer

    const previewCount = appState.likedTracks.length;
    console.log(
      `Beğenilen ${appState.likedTracks.length} şarkı yüklendi. ${previewCount} tanesinde preview_url var.`
    );

    renderLikedTracks();
    return appState.likedTracks;
  } catch (err) {
    console.error('Spotify liked tracks error:', err.response?.data || err);
    const status = err.response?.status;
    if (status === 401 && !isRetry) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        return await fetchSpotifyLikedTracks(true);
      }
      handleLogout();
    }
    return [];
  }
}

async function fetchSpotifyPlaylists(isRetry = false) {
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
    const status = err.response?.status;
    if (status === 401 && !isRetry) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        return await fetchSpotifyPlaylists(true);
      }
      handleLogout();
    }
    return [];
  }
}

async function fetchSpotifyPlaylistTracks(playlistId, playlistName, isRetry = false) {
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
    const status = err.response?.status;
    if (status === 401 && !isRetry) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        return await fetchSpotifyPlaylistTracks(playlistId, playlistName, true);
      }
      handleLogout();
    }
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

  // Beğenilen şarkılar öğesi
  const likedItem = document.createElement('div');
  likedItem.className = 'playlist-item';
  likedItem.innerHTML = `
    <div class="playlist-img liked">
      <i class="fas fa-heart" style="color: white; font-size: 20px;"></i>
    </div>
    <div class="playlist-info">
      <div class="playlist-name">Beğenilen Şarkılar</div>
      <div class="playlist-meta">Çalma listesi • ${appState.likedTracks.length} şarkı</div>
    </div>
  `;
  likedItem.addEventListener('click', () => {
    container.querySelectorAll('.playlist-item').forEach(item => item.classList.remove('active'));
    likedItem.classList.add('active');
    renderLikedTracks();
  });
  container.appendChild(likedItem);

  // Çalma listeleri
  appState.playlists.forEach(playlist => {
    const item = document.createElement('div');
    item.className = 'playlist-item';
    item.innerHTML = `
      <img class="playlist-img" src="${playlist.image || ''}" alt="${playlist.name}">
      <div class="playlist-info">
        <div class="playlist-name">${playlist.name}</div>
        <div class="playlist-meta">Çalma listesi • ${playlist.tracksTotal} şarkı</div>
      </div>
    `;
    item.addEventListener('click', () => {
      container.querySelectorAll('.playlist-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      fetchSpotifyPlaylistTracks(playlist.id, playlist.name);
    });
    container.appendChild(item);
  });
}

async function loadSpotifyLibrary() {
  if (!appState.spotifyAccessToken) return;
  await fetchSpotifyLikedTracks();
  await fetchSpotifyPlaylists();
  await fetchSpotifyUserProfile();
}

async function fetchSpotifyUserProfile(isRetry = false) {
  if (!appState.spotifyAccessToken) return;

  try {
    const res = await axios.get('https://api.spotify.com/v1/me', {
      headers: getSpotifyHeaders()
    });

    appState.spotifyUser = res.data;
    updateUserAvatar();
  } catch (err) {
    console.error('Spotify user profile error:', err.response?.data || err);
    const status = err.response?.status;
    if (status === 401 && !isRetry) {
      const refreshed = await refreshSpotifyToken();
      if (refreshed) {
        return await fetchSpotifyUserProfile(true);
      }
      handleLogout();
    }
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
      if (action === 'profile') {
        const user = appState.spotifyUser;
        const url = (user && user.external_urls && user.external_urls.spotify)
          ? user.external_urls.spotify
          : 'https://open.spotify.com/';
        shell.openExternal(url);
      } else if (action === 'settings') {
        shell.openExternal('https://www.spotify.com/account/overview/');
      } else if (action === 'logout') {
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

  // Sağ panel güncellemesi
  if (elements.nowPlayingImgLarge && track.image) {
    elements.nowPlayingImgLarge.src = track.image;
  }
  if (elements.nowPlayingTitleLarge) {
    elements.nowPlayingTitleLarge.textContent = track.title;
  }
  if (elements.nowPlayingArtistLarge) {
    elements.nowPlayingArtistLarge.textContent = track.artist;
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
    console.log(`[Renderer] YouTube sesini alıyor: ${videoId}`);
    const audioUrl = await ipcRenderer.invoke('youtube:get-audio-url', videoId);
    if (!audioUrl) throw new Error('Main process ses URL döndürmedi');
    return audioUrl;
  } catch (error) {
    console.error('[Renderer] YouTube ses hatası:', error);
    return null;
  }
}

async function fallbackYoutubeSearch(query) {
  try {
    console.log(`[Renderer] YouTube araması: ${query}`);
    const videoId = await ipcRenderer.invoke('youtube:search', query);
    return videoId;
  } catch (error) {
    console.error('[Renderer] YouTube arama hatası:', error);
    return null;
  }
}

async function searchYoutubeForTrack(track) {
  if (!track) return null;

  const query = `${track.title} ${track.artist}`.trim();

  console.log(`[Renderer] YouTube'da aranıyor: ${query}`);
  const videoId = await fallbackYoutubeSearch(query);

  if (videoId) {
    track.youtubeId = videoId;
    appState.currentVideoId = videoId;
    return videoId;
  }
  return null;
}

function playTrackAtIndex(index) {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) return;
  if (index < 0 || index >= appState.queue.length) return;
  appState.currentTrackIndex = index;
  const track = appState.queue[index];
  playTrack(track);
}

async function playTrack(track) {
  if (!track) return;

  // Geçişlerde yarış durumunu engellemek için token üret
  const playToken = Symbol('play');
  appState.playToken = playToken;

  appState.currentTrack = track;
  updatePlayerUI(track);

  try {
    let src = null;

    if (track.previewUrl) {
      src = track.previewUrl;
      appState.currentVideoId = null;
    } else {
      let videoId = track.youtubeId || null;
      if (!videoId) {
        videoId = await searchYoutubeForTrack(track);
      }

      // Bu arada başka bir şarkıya geçildiyse iptal et
      if (appState.playToken !== playToken) return;

      if (videoId) {
        const audioUrl = await getYoutubeAudioUrl(videoId);

        // Bu arada başka bir şarkıya geçildiyse iptal et
        if (appState.playToken !== playToken) return;

        if (audioUrl) {
          src = audioUrl;
        }
      }
    }

    if (!src) {
      throw new Error('Akış URL bulunamadı');
    }

    // Bu arada başka bir şarkıya geçildiyse iptal et
    if (appState.playToken !== playToken) return;

    // Mevcut oynatımı sıfırla
    appState.audioElement.pause();
    appState.audioElement.currentTime = 0;
    appState.audioElement.src = '';
    appState.audioElement.src = src;
    appState.audioElement.volume = appState.volume;

    // Token hâlâ geçerli mi kontrol et
    if (appState.playToken !== playToken) return;

    // Kısa bir gecikme sonra play et (src yüklenmesi için)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Token hâlâ geçerli mi kontrol et
    if (appState.playToken !== playToken) return;

    try {
      const playPromise = appState.audioElement.play();
      if (playPromise !== undefined && playPromise !== null) {
        try {
          await playPromise;
        } catch (playPromiseErr) {
          console.warn('Play promise reddedildi (ancak devam ediliyor):', playPromiseErr.message);
        }
      }
      appState.isPlaying = true;
      updatePlayPauseButton();
    } catch (playErr) {
      console.error('Play reddedildi/başarısız:', playErr.message);
      appState.isPlaying = false;
      updatePlayPauseButton();
    }
  } catch (err) {
    console.error('Şarkı çalınamadı:', err);
    appState.isPlaying = false;
    updatePlayPauseButton();
  }
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
  if (!seconds || !isFinite(seconds) || Number.isNaN(seconds)) return '0:00';
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
  // Slider arka planını güncelle
  if (elements.volumeSlider) {
    const percent = e.target.value;
    elements.volumeSlider.style.background = `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${percent}%, rgba(255,255,255,0.1) ${percent}%)`;
  }
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
  await downloadTrack(track);
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

  // Temel event listeners
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('ended', handleTrackEnded);

  // Hata ve yükleme event listeners
  audio.addEventListener('error', (event) => {
    console.error('[Renderer] Audio element hatası:', event);
    console.error('[Renderer] Audio error code:', audio.error?.code);
    console.error('[Renderer] Audio error message:', audio.error?.message);
    appState.isPlaying = false;
    updatePlayPauseButton();
  });

  audio.addEventListener('loadstart', () => {
    console.log('[Renderer] Audio yükleme başladı');
  });

  audio.addEventListener('loadedmetadata', () => {
    console.log('[Renderer] Audio metadata yüklendi');
  });

  audio.addEventListener('canplay', () => {
    console.log('[Renderer] Audio çalınmaya hazır (canplay)');
  });

  audio.addEventListener('canplaythrough', () => {
    console.log('[Renderer] Audio tam çalınmaya hazır (canplaythrough)');
  });

  audio.addEventListener('playing', () => {
    console.log('[Renderer] Audio oynatıldı');
  });

  audio.addEventListener('pause', () => {
    console.log('[Renderer] Audio duraklatıldı');
  });

  audio.addEventListener('seeking', () => {
    console.log('[Renderer] Audio aranıyor');
  });

  audio.addEventListener('seeked', () => {
    console.log('[Renderer] Audio arama tamamlandı');
  });

  // Kontrol butonları
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

async function refreshSpotifyToken() {
  if (!appState.spotifyRefreshToken) {
    console.error('Spotify refresh token yok, yeniden giriş gerekli');
    return false;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const postData = querystring.stringify({
    grant_type: 'refresh_token',
    refresh_token: appState.spotifyRefreshToken,
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

  try {
    const tokens = await new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.error || 'Spotify refresh token error'));
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

    appState.spotifyAccessToken = tokens.access_token;
    if (tokens.refresh_token) {
      appState.spotifyRefreshToken = tokens.refresh_token;
    }
    appState.spotifyTokenExpiresAt = Date.now() + (tokens.expires_in || 0) * 1000;

    saveSpotifyToStorage();
    updateSpotifyButton();
    console.log('Spotify access token yenilendi');
    return true;
  } catch (err) {
    console.error('Spotify refresh token error:', err);
    return false;
  }
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

// Offline şarkıları yükle
async function loadOfflineTracks() {
  try {
    const tracks = await ipcRenderer.invoke('offline:list');
    appState.offlineTracks = tracks || [];
    console.log(`[Renderer] ${appState.offlineTracks.length} offline şarkı yüklendi`);
  } catch (error) {
    console.error('[Renderer] Offline şarkılar yüklenemedi:', error);
  }
}

// Şarkı indir
async function downloadTrack(track) {
  if (!track || !appState.currentVideoId) {
    alert('Şarkı indirilemedi');
    return;
  }

  try {
    console.log(`[Renderer] İndiriliyor: ${track.title}`);
    const result = await ipcRenderer.invoke('youtube:download', {
      videoId: appState.currentVideoId,
      title: track.title,
      artist: track.artist
    });

    if (result.success) {
      alert(`✓ "${track.title}" indirildi!`);
      await loadOfflineTracks();
    } else {
      alert(`✗ İndirme hatası: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] İndirme hatası:', error);
    alert('İndirme başarısız oldu');
  }
}

// Offline şarkı sil
async function deleteOfflineTrack(filePath) {
  if (!confirm('Bu şarkıyı silmek istediğine emin misin?')) return;

  try {
    const result = await ipcRenderer.invoke('offline:delete', filePath);
    if (result.success) {
      alert('Şarkı silindi');
      await loadOfflineTracks();
    } else {
      alert(`Silme hatası: ${result.error}`);
    }
  } catch (error) {
    console.error('[Renderer] Silme hatası:', error);
  }
}

// Offline şarkı çal
function playOfflineTrack(filePath) {
  try {
    appState.audioElement.src = `file://${filePath}`;
    appState.audioElement.play();
    appState.isPlaying = true;
    updatePlayPauseButton();
  } catch (error) {
    console.error('[Renderer] Offline şarkı çalınamadı:', error);
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
  loadOfflineTracks();

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

  // Ses slider başlangıç değeri
  if (elements.volumeSlider) {
    const initialVolume = elements.volumeSlider.value;
    elements.volumeSlider.style.background = `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${initialVolume}%, rgba(255,255,255,0.1) ${initialVolume}%)`;
  }

  // Logo'ya tıklayınca ana sayfaya git
  const logoEl = document.getElementById('sidebar-logo');
  if (logoEl) {
    logoEl.addEventListener('click', (e) => {
      e.preventDefault();
      const main = document.querySelector('.main-content');
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
      // Beğenilen şarkıları göster
      renderLikedTracks();
      // Content tab'ları sıfırla
      document.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
      const firstTab = document.querySelector('.content-tab');
      if (firstTab) firstTab.classList.add('active');
    });
  }

  // Content tab'ları (Tümü, Müzik, Podcast'ler)
  const contentTabs = document.querySelectorAll('.content-tab');
  contentTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      contentTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabType = tab.dataset.tab;
      const likedSection = document.getElementById('liked-section');
      const playlistsSection = document.getElementById('playlists-section');
      
      if (tabType === 'all') {
        if (likedSection) likedSection.style.display = 'block';
        if (playlistsSection) playlistsSection.style.display = 'block';
      } else if (tabType === 'music') {
        if (likedSection) likedSection.style.display = 'block';
        if (playlistsSection) playlistsSection.style.display = 'block';
      } else if (tabType === 'podcasts') {
        if (likedSection) likedSection.style.display = 'none';
        if (playlistsSection) playlistsSection.style.display = 'none';
      }
    });
  });

  // Sidebar tab'ları
  const sidebarTabs = document.querySelectorAll('.sidebar-tab');
  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sidebarTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
});

