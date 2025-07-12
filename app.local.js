// 🦉 (NZB) Nocna Zmaza Bluesa v.89 - Optimized Version

// Helper: Clear all app data
function clearAllAppData() {
    [
        "ytQueue","ytHistoria","ytChannels","ytLastFilmsByChannel","ytQueuePlaying",
        "ytUserApiKey","ytSoftNight","ytGlobalVol","ytQueueRepeat","ytQueueMode"
    ].forEach(k=>localStorage.removeItem(k));
}

// wybor następnego indeksu
function getNextQueueIndex(currentIdx) {
    const queue = getQueue();
    const mode = localStorage.getItem("ytQueueMode") || "classic";
    if (!queue.length) return null;

    const watchedIds = getWatchedIds();

    if (mode === "random") {
        // Wybierz tylko indeksy nieodtworzonych filmów
        const notPlayedIndexes = queue
            .map((item, idx) => watchedIds.includes(item.id) ? null : idx)
            .filter(idx => idx !== null && idx !== currentIdx);

        let candidates = notPlayedIndexes.length ? notPlayedIndexes : 
            queue.map((item, idx) => idx).filter(idx => idx !== currentIdx);

        if (candidates.length === 0) return currentIdx; // tylko jeden film w kolejce

        const next = candidates[Math.floor(Math.random() * candidates.length)];
        return next;
    } else if (mode === "alternate") {
        const queueChannel = queue[currentIdx]?.channel;
        for (let i = 1; i < queue.length; i++) {
            const idx = (currentIdx + i) % queue.length;
            if (queue[idx].channel !== queueChannel) return idx;
        }
        return (currentIdx + 1) % queue.length;
    } else {
        // Klasyczny tryb: po kolei
        return (currentIdx + 1) % queue.length;
    }
}


// ========== Performance Optimizations ==========

function setQueue(q) {
    localStorage.setItem("ytQueue", JSON.stringify(q));
    renderQueue();
    renderStats();
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function getVideoInfo(videoId, callback) {
    const cacheKey = `video_info_${videoId}`;
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    
    safeYTApiCall(url, cacheKey).then(data => {
        if (data?.items?.[0]) {
            const snippet = data.items[0].snippet;
            const videoData = {
                id: videoId,
                title: snippet.title,
                channel: snippet.channelTitle || "nieznany"
            };
            callback(videoData);
        } else {
            callback(null);
        }
    }).catch(err => {
        console.error('getVideoInfo error:', err);
        callback(null);
    });
}

// API Cache with TTL
class APICache {
    constructor(ttl = 3600000) { // 1 hour default
        this.cache = new Map();
        this.ttl = ttl;
    }
    
    set(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
    
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return item.data;
    }
    
    clear() {
        this.cache.clear();
    }
}

const apiCache = new APICache();

// Smart API calls with rate limiting
async function safeYTApiCall(url, cacheKey = null) {
    // Check cache first
    if (cacheKey) {
        const cached = apiCache.get(cacheKey);
        if (cached) {
            showDebug("📦 Dane z cache", "ok");
            return cached;
        }
    }
    
    // Rate limiting check
    const lastCall = localStorage.getItem('lastApiCall');
    const now = Date.now();
    const minInterval = 100; // 100ms between calls
    
    if (lastCall && (now - parseInt(lastCall)) < minInterval) {
        await new Promise(resolve => setTimeout(resolve, minInterval));
    }
    
    try {
        const response = await fetch(url);
        localStorage.setItem('lastApiCall', now.toString());
        
        if (!response.ok) {
            if (response.status === 429) {
                showDebug("⏰ Rate limit - czekam 5s", "warn");
                await new Promise(resolve => setTimeout(resolve, 5000));
                return safeYTApiCall(url, cacheKey); // Retry
            }
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Cache successful response
        if (cacheKey && data) {
            apiCache.set(cacheKey, data);
        }
        
        return data;
    } catch (error) {
        showDebug(`❌ API Error: ${error.message}`, "error");
        return null;
    }
}

// ========== Progress Tracking ==========
let progressInterval = null;

function startProgressTracking() {
    if (progressInterval) clearInterval(progressInterval);
    
    progressInterval = setInterval(() => {
        if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
            try {
                const current = ytPlayer.getCurrentTime();
                const total = ytPlayer.getDuration();
                
                if (total > 0) {
                    const progress = (current / total) * 100;
                    updateProgressInDebug(current, total, progress);
                }
            } catch (e) {
                // Player not ready yet
            }
        }
    }, 1000);
}

function updateProgressInDebug(current, total, progress) {
    const queue = getQueue();
    const playingIdx = Number(localStorage.getItem("ytQueuePlaying"));
    
    if (queue[playingIdx]) {
        const currentTitle = queue[playingIdx].title;
        const progressText = `${formatTime(current)}/${formatTime(total)} - ${Math.round(progress)}%`;
        
        // Aktualizuj debug z tytułem + progress
        showDebug(`▶️ <b>${currentTitle}</b> - [${progressText}]`, "ok");
    }
}

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        // Format: 1:51:45 (dla filmów dłuższych niż godzina)
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        // Format: 51:45 (dla filmów krótszych niż godzina)
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

function stopProgressTracking() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    
    // Cleanup progress display
    document.querySelectorAll('.progress-info').forEach(el => el.remove());
    document.querySelectorAll('.mini-progress-bar').forEach(el => el.remove());
}

// ========== Theme & API Key Boot ==========

function updateModeButtons() {
    let active = localStorage.getItem("ytQueueMode") || "classic";
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    let activeBtn = document.getElementById("mode-" + active);
    if (activeBtn) activeBtn.classList.add('active');
}

function colorLabel(txt) {
    if (txt.endsWith(':')) return `<span style="color:#bbb">${txt} </span>`;
    return `<span style="color:#bbb">${txt}</span>`;
}

function colorStatus(ok, txt) {
    if (ok === true) return `<span style="color:#00ee44;font-weight:bold">${txt}</span>`;
    if (ok === "warn") return `<span style="color:#ffd700;font-weight:bold">${txt}</span>`;
    return `<span style="color:#ff4444;font-weight:bold">${txt}</span>`;
}

function colorValue(val, color) {
    return `<span style="color:${color};font-weight:bold">${val}</span>`;
}

function getShortBrowserInfo() {
    let ua = navigator.userAgent.toLowerCase();
    if (ua.includes("firefox")) return "ff";
    if (ua.includes("edg/")) return "edge";
    if (ua.includes("chrome")) return "chrome";
    if (ua.includes("safari")) return "safari";
    if (ua.includes("opr") || ua.includes("opera")) return "opera";
    return "inne";
}

// ⭐ BLOKADA FORMULARZA BEZ API KEY
function updateFormState() {
    const form = document.getElementById('yt-universal-form');
    const input = document.getElementById('yt_universal_input');
    const submitBtn = form?.querySelector('button[type="submit"]');
    
    if (!form || !input || !submitBtn) return;
    
    const hasValidKey = checkAPIKeyValid();
    
    if (!hasValidKey) {
        input.disabled = true;
        input.placeholder = "🔑 Wymagany klucz API YouTube - kliknij tutaj aby skonfigurować";
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.5";
        submitBtn.style.cursor = "not-allowed";
        
        // Event listener na kliknięcie w input
        input.onclick = () => {
            showAPIKeySetupModal();
        };
        input.style.cursor = "pointer";
    } else {
        input.disabled = false;
        input.placeholder = "Wklej link lub ID: film, kanał, playlista...";
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
        input.onclick = null;
        input.style.cursor = "text";
    }
}

function checkAPIKeyValid() {
    const savedKey = localStorage.getItem("ytUserApiKey");
    return savedKey && savedKey.trim() && savedKey.length > 20;
}

// ⭐ NAJPROSTSZE ROZWIĄZANIE - używaj prompt() zamiast skomplikowanego modala
function showAPIKeySetupModal() {
    const currentKey = localStorage.getItem("ytUserApiKey") || "";
    
    const choice = confirm(
        "🔑 KONFIGURACJA KLUCZA YOUTUBE API\n\n" +
        "Potrzebujesz własny klucz API aby aplikacja działała.\n\n" +
        "✅ Bezpłatny - Google daje 10,000 zapytań dziennie\n" +
        "✅ Tylko dla Ciebie - nikt nie zużywa Twojego limitu\n" +
        "✅ 5 minut konfiguracji\n\n" +
        "Kliknij OK aby otworzyć Google Console\n" +
        "Kliknij Cancel aby wkleić istniejący klucz"
    );
    
    if (choice) {
        // Otwórz Google Console
        window.open('https://console.cloud.google.com/apis/credentials', '_blank');
        
        // Po chwili zapytaj o klucz
        setTimeout(() => {
            const newKey = prompt(
                "🔑 WKLEJ KLUCZ Z GOOGLE CONSOLE:\n\n" +
                "1. W Google Console utwórz 'API Key'\n" +
                "2. Włącz 'YouTube Data API v3'\n" +
                "3. Skopiuj klucz i wklej poniżej:",
                currentKey
            );
            
            if (newKey && newKey.length > 30) {
                testAndSaveKey(newKey);
            } else if (newKey !== null) {
                showDebug("❌ Klucz wydaje się za krótki", "error");
            }
        }, 2000);
    } else {
        // Bezpośrednio zapytaj o klucz
        const newKey = prompt(
            "🔑 WKLEJ SWÓJ KLUCZ YOUTUBE API:\n\n" +
            "Klucz powinien zaczynać się od 'AIza...'",
            currentKey
        );
        
        if (newKey && newKey.length > 30) {
            testAndSaveKey(newKey);
        } else if (newKey !== null) {
            showDebug("❌ Klucz wydaje się za krótki", "error");
        }
    }
}

// ⭐ FUNKCJA TESTUJĄCA I ZAPISUJĄCA KLUCZ
function testAndSaveKey(key) {
    showDebug("🔄 Testuję klucz API...", "warn");
    
    fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=${key}`)
    .then(r => r.json())
    .then(data => {
        console.log('📦 API test result:', data);
        
        if (data && data.items && data.items.length > 0) {
            // Klucz działa!
            localStorage.setItem("ytUserApiKey", key);
            apiKey = key;
            showDebug("✅ Klucz API zapisany i przetestowany!", "ok");
            updateFormState(); // Odblokuj formularz
            
            setTimeout(() => {
                showDebug("Ready, Nocna Zmaza Bluesa v.89 🦉", "ok");
            }, 2000);
            
        } else if (data && data.error) {
            // Błąd API
            const errorMsg = data.error.message || 'Nieznany błąd API';
            showDebug(`❌ Błąd API: ${errorMsg}`, "error");
            
            // Pokaż instrukcje
            setTimeout(() => {
                alert(
                    "❌ KLUCZ NIE DZIAŁA\n\n" +
                    "Możliwe przyczyny:\n" +
                    "• Klucz nieprawidłowy\n" +
                    "• YouTube Data API v3 nie włączone\n" +
                    "• Ograniczenia klucza\n\n" +
                    "Sprawdź konfigurację w Google Console"
                );
            }, 1000);
        } else {
            showDebug("❌ Nieoczekiwana odpowiedź API", "error");
        }
    })
    .catch(err => {
        console.error('❌ Fetch error:', err);
        showDebug(`❌ Błąd połączenia: ${err.message}`, "error");
    });
}

function openGoogleConsole() {
    window.open('https://console.cloud.google.com/apis/credentials', '_blank');
    showDebug("🌐 Otwarto Google Console. Wygeneruj klucz i wróć tutaj.", "ok");
}

document.addEventListener('DOMContentLoaded', function() {
    // Theme
    const btn = document.getElementById('toggle-theme-btn');
    btn.onclick = () => {
        document.body.classList.toggle('soft-night');
        localStorage.setItem('ytSoftNight', document.body.classList.contains('soft-night') ? '1' : '');
    };
    if (localStorage.getItem('ytSoftNight')==='1') document.body.classList.add('soft-night');

    showDebug('Inicjalizacja v.89…');

    // API Key test
    function checkDebugStatus() {
        testYouTubeAPIKey(function(apiOk) {
            let filesOk = true;
            let testKeys = ["ytQueue", "ytHistoria", "ytChannels"];
            try {
                testKeys.forEach(k => {
                    let v = localStorage.getItem(k);
                    if (k !== "ytQueuePlaying" && v && v !== "null") {
                        JSON.parse(v);
                    }
                });
            } catch(e) {
                filesOk = false;
            }

            const maxLS = 5 * 1024 * 1024;
            const lsSize = JSON.stringify(localStorage).length;
            let lsState = "ok";
            let lsColor = "#00ee44";
            if (lsSize > maxLS * 0.9) {
                lsState = "critical";
                lsColor = "#ff4444";
            } else if (lsSize > maxLS * 0.7) {
                lsState = "warn";
                lsColor = "#ffd700";
            }
            
            const browserShort = getShortBrowserInfo();

            let apiStatusText = colorStatus(apiOk === true, "OK");
            let apiLabel = colorLabel("API:");
            if (apiOk !== true) apiStatusText = colorStatus(false, "BŁĄD");

            let filesStatus = colorStatus(filesOk === true, "OK");
            let filesLabel = colorLabel("PLIKI:");
            if (filesOk !== true) filesStatus = colorStatus(false, "BŁĄD");

            let ver = colorLabel("v.89");

            let lsVal = colorValue(`${lsSize}B/>=5MB`, lsColor);
            let lsLabel = colorLabel("local storage:");

            let browserLabel = colorLabel("browser:");
            let browserVal = colorStatus(true, browserShort);

            let pipe = `<span style="color:#bbb">&nbsp;|&nbsp;</span>`;

            let debugMsg =
                `${apiLabel} ${apiStatusText}` + pipe +
                `${filesLabel} ${filesStatus}` + pipe +
                `${ver}` + pipe +
                `${lsLabel} ${lsVal}` + pipe +
                `${browserLabel} ${browserVal}`;

            showDebug(debugMsg, (apiOk === true && filesOk === true && lsState === "ok") ? "ok" :
                (apiOk !== true || filesOk !== true || lsState === "warn") ? "warn" : "error"
            );

            // ⭐ Aktualizuj stan formularza na podstawie API key
            updateFormState();
        });
    }

    checkDebugStatus();
    
    // ========== Keyboard Shortcuts ==========
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        switch(e.key) {
            case ' ': // Spacja - play/pause
                e.preventDefault();
                if (ytPlayer && ytPlayer.getPlayerState) {
                    const state = ytPlayer.getPlayerState();
                    if (state === 1) {
                        ytPlayer.pauseVideo();
                        showDebug("⏸️ Paused", "warn");
                    } else {
                        ytPlayer.playVideo();
                        showDebug("▶️ Playing", "ok");
                    }
                }
                break;
                
            case 'ArrowRight': // Następny film
                e.preventDefault();
                document.getElementById('play-next-btn')?.click();
                showDebug("⏭️ Następny film", "ok");
                break;
                
            case 'ArrowUp': // Głośniej
                e.preventDefault();
                setGlobalVolume(Math.min(100, getGlobalVolume() + 5));
                break;
                
            case 'ArrowDown': // Ciszej
                e.preventDefault();
                setGlobalVolume(Math.max(0, getGlobalVolume() - 5));
                break;
                
            case 'm': // Mute toggle
                e.preventDefault();
                if (ytPlayer && ytPlayer.isMuted !== undefined) {
                    if (ytPlayer.isMuted()) {
                        ytPlayer.unMute();
                        showDebug("🔊 Unmuted", "ok");
                    } else {
                        ytPlayer.mute();
                        showDebug("🔇 Muted", "warn");
                    }
                }
                break;
                
            case 'h': // Help
                e.preventDefault();
                showKeyboardHelp();
                break;
        }
    });
});

// ========== API Key ==========
let apiKey = localStorage.getItem("ytUserApiKey") || "";

function testYouTubeAPIKey(cb) {
    if (!apiKey) return cb(false);
    fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=${apiKey}`)
    .then(r => r.json())
    .then(data => { cb(!!(data && data.items)); })
    .catch(() => cb(false));
}

// ========== LocalStorage: Queue, Channels, History ==========
function getQueue() { try { return JSON.parse(localStorage.getItem("ytQueue") || "[]"); } catch{ return [];} }
function saveQueue(queue) {
    localStorage.setItem("ytQueue", JSON.stringify(queue));
    renderQueue();
    renderStats();
}
function getChannels() {
    try {
        let chs = JSON.parse(localStorage.getItem('ytChannels') || 'null');
        if (!Array.isArray(chs)) throw 1;
        return chs;
    } catch {
        const chs = [];
        localStorage.setItem('ytChannels', JSON.stringify(chs));
        showDebug("Przywrócono domyślne kanały", "warn");
        return chs;
    }
}
function setChannels(chs) {
    localStorage.setItem('ytChannels', JSON.stringify(chs));
    renderAll();
}
function getHistoria() { try { return JSON.parse(localStorage.getItem('ytHistoria')||'[]'); } catch{ return [];} }
function setHistoria(arr) { localStorage.setItem('ytHistoria', JSON.stringify(arr)); renderHistoria(); renderStats(); }
function getWatchedIds() { return getHistoria().map(h => h.video_id); }

// ========== Queue, Channel, History: Core actions ==========
function addToQueue(video) {
    let q = getQueue();
    if (!q.find(e => e.id === video.id)) {
        q.push(video);
        setQueue(q);
        showDebug(`Dodano do kolejki: <b>${video.title}</b>`, "ok");
    } else {
        showDebug("Już w kolejce!", "warn");
    }
}
function removeFromQueue(id) {
    let q = getQueue().filter(e => e.id !== id);
    setQueue(q);
    showDebug("Usunięto z kolejki", "ok");
}
function addChannel(id, nazwa) {
    let chs = getChannels();
    if (chs.find(c => c.id === id)) return showDebug('Kanał już istnieje!', "warn");
    chs.push({id, nazwa});
    setChannels(chs);
    showDebug(`Dodano kanał: <b>${nazwa}</b>`, "ok");
}
function removeChannel(id) {
    let chs = getChannels().filter(c => c.id !== id);
    setChannels(chs);
    let ch = chs.find(c=>c.id===id);
    if (ch) {
        setHistoria(getHistoria().filter(h => h.channel !== ch.nazwa));
        setQueue(getQueue().filter(q => q.channel !== ch.nazwa));
    }
    let filmsByChannel = JSON.parse(localStorage.getItem("ytLastFilmsByChannel")||"{}");
    delete filmsByChannel[id];
    localStorage.setItem("ytLastFilmsByChannel", JSON.stringify(filmsByChannel));
    showDebug("Kanał usunięty i powiązane dane wyczyszczone", "ok");
}

// ========== Kolejka: renderowanie OPTIMIZED ==========
function createQueueItem(v, actualIdx, playingIdx) {
    const li = document.createElement('li');
    li.className = 'queue-item';

    // Tylko filmy z historii są skreślone
    const watchedIds = getWatchedIds();

    let statusClass = "";
    let prefix = "";
    let style = "";

    if (actualIdx === playingIdx) {
        statusClass = "playing";
        style = "background:#2c4a2c;color:#dfffa7;font-weight:bold;";
        prefix = "";
    } else if (watchedIds.includes(v.id)) {
        statusClass = "played";
        style = "opacity:0.6;text-decoration:line-through;";
        prefix = "<span class='played-prefix'>✔</span>";
    } else {
        // NIE nadajemy stylu! ani statusClass
        style = "";
        prefix = "";
    }

    li.className += ` ${statusClass}`;
    li.setAttribute("style", style);

    li.innerHTML = `
        <span class="queue-info">
            <span class="queue-title">${prefix}${v.title.length > 33 ? v.title.slice(0, 29) + "…" : v.title}</span>
            <span class="queue-channel">${v.channel || ""}</span>
        </span>
        <span class="queue-actions">
            <button class="queue-play-btn" title="Odtwórz" onclick="playFromQueue(${actualIdx},0)"><span>▶️</span></button>
            <button class="queue-remove-btn" title="Usuń z kolejki" onclick="removeFromQueue('${v.id}')"><span>🗑️</span></button>
        </span>
    `;

    return li;
}
// Zmieniona funkcja renderQueueOptimized
function renderQueueOptimized() {
    const listUl = document.getElementById('queue-list');
    const queue = getQueue();
    const playingIdx = Number(localStorage.getItem("ytQueuePlaying"));

    document.getElementById("queue-count").innerText = queue.length ? `(${queue.length})` : "";

    if (queue.length === 0) {
        listUl.innerHTML = "<li style='color:#ffedc1;text-align:center;width:100%'>Kolejka jest pusta</li>";
        document.getElementById("player").innerHTML = "";
        document.getElementById("play-next-btn").style.display = "none";
        return;
    }

    // Virtual scrolling for performance
    const VISIBLE_ITEMS = 15;
    const maxToShow = Math.min(queue.length, VISIBLE_ITEMS);

    const fragment = document.createDocumentFragment();

    queue.slice(0, maxToShow).forEach((v, i) => {
        const li = createQueueItem(v, i, playingIdx);
        fragment.appendChild(li);
    });

    if (queue.length > VISIBLE_ITEMS) {
        const li = document.createElement('li');
        li.style.textAlign = 'center';
        li.innerHTML = `
            <button id="show-full-queue-btn" style="margin-top:8px;padding:0.5em 1.3em;border-radius:8px;background:#232;color:#fff;font-size:1.07em;cursor:pointer;">
                Pokaż całą kolejkę (${queue.length})
            </button>
        `;
        fragment.appendChild(li);
    }

    listUl.innerHTML = '';
    listUl.appendChild(fragment);

    const nextBtn = document.getElementById("play-next-btn");
    const isStarted = !isNaN(playingIdx) && playingIdx >= 0 && playingIdx < queue.length;
    if (nextBtn) {
        nextBtn.innerHTML = "▶️ " + (isStarted ? "Następny" : "Startuj");
        nextBtn.style.display = "block";
        nextBtn.onclick = function () {
            let idx = parseInt(localStorage.getItem("ytQueuePlaying") || "-1", 10);
            if (!isStarted) {
                playFromQueue(0, 0);
            } else {
                const nextIdx = getNextQueueIndex(idx);
                playFromQueue(nextIdx, 0);
            }
        };
    }

    if (queue.length > VISIBLE_ITEMS) {
        const btn = document.getElementById("show-full-queue-btn");
        if (btn) btn.onclick = showFullQueueModal;
    }
}

// Alias for backward compatibility
function renderQueue() {
    renderQueueOptimized();
}

// ========== Show Full Queue Modal ==========
function showFullQueueModal() {
    const queue = getQueue();
    const playingIdx = Number(localStorage.getItem("ytQueuePlaying"));
    const watchedIds = getWatchedIds();

    let html = "<h3>Pełna kolejka (" + queue.length + " filmów)</h3>";
    html += "<div style='max-height:60vh;overflow-y:auto;'><ol>";

    queue.forEach((v, i) => {
        let style = "";
        let prefix = "";
        if (i === playingIdx) {
            style = "background:#2c4a2c;color:#dfffa7;font-weight:bold;";
            prefix = "▶️ ";
        } else if (watchedIds.includes(v.id)) {
            style = "opacity:0.6;text-decoration:line-through;";
            prefix = "✔ ";
        }
        // NIE nadajemy stylu ani prefixu po indeksie!

        html += `<li style='${style}'>${prefix}<b>${v.title}</b> (${v.channel || "nieznany"}) 
                 <button onclick="playFromQueue(${i},0);closeModal();" style="margin-left:1em;font-size:0.9em;background:#28a745;color:#fff;border:none;padding:0.2em 0.8em;border-radius:4px;">▶️</button>
                 <button onclick="removeFromQueue('${v.id}');closeModal();showFullQueueModal();" style="margin-left:0.5em;font-size:0.9em;background:#dc3545;color:#fff;border:none;padding:0.2em 0.8em;border-radius:4px;">🗑️</button>
                 </li>`;
    });

    html += "</ol></div>";
    html += "<button onclick='closeModal()' style='margin-top:1em;padding:0.5em 1em;font-size:1.1em;'>Zamknij</button>";
    modal(html);
}

// ========== Historia ==========
function saveHistory(video) {
    let hist = getHistoria();
    if (hist.length && hist[hist.length - 1].video_id === video.id) return;
    hist.push({
        video_id: video.id,
        title: video.title,
        channel: video.channel,
        date: (new Date()).toLocaleString()
    });
    if (hist.length > 100) hist = hist.slice(hist.length-100);
    setHistoria(hist);
}

function renderHistoria() {
    let hist = getHistoria();
    let html = "";
    if (!Array.isArray(hist) || hist.length === 0) {
        html = "<span style='color:#bbb'>Brak historii</span>";
    } else {
        hist.slice(-3).reverse().forEach(h => {
            html += `<span style="margin-right:1.5em;">
                <b>${h.title.length>20?h.title.slice(0,17)+"…":h.title}</b>
                <small style="color:#aaa">(${h.channel}, ${h.date.split(",")[0]})</small>
            </span>`;
        });
        html += `<button onclick="showFullHistory()" style="margin-left:0.7em;font-size:0.95em;background:#222;color:#aaf;border-radius:6px;">HISTORIA</button>`;
        html += `<button onclick="showStatusDebug()" style="margin-left:0.5em;font-size:0.95em;background:#222;color:#8f8;border-radius:6px;">STATUS</button>`;
    }
    document.getElementById("history-row").innerHTML = html;
}

function clearAppCacheNoApiKey() {
    [
        "ytQueue","ytHistoria","ytChannels","ytLastFilmsByChannel","ytQueuePlaying",
        "ytSoftNight","ytGlobalVol","ytQueueRepeat","ytQueueMode"
    ].forEach(k=>localStorage.removeItem(k));
}

function resetPlayerAndQueue() {
    // Zatrzymaj i usuń playera
    if (ytPlayer && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }
    ytPlayer = null;
    sessionPlayed = 0;
    localStorage.removeItem("ytQueuePlaying");
    document.getElementById("player").innerHTML = "";
    renderQueue();
    renderStats();
}

function showFullHistory() {
    let hist = getHistoria();
    const MAX_HIST = 50;
    let shown = hist.slice(-MAX_HIST).reverse();
    let html = "<h3>Pełna historia oglądania:</h3><ol>";
    shown.forEach(h => {
        html += `<li><b>${h.title}</b> (${h.channel}) <a href="https://www.youtube.com/watch?v=${h.video_id}" target="_blank" style="color:#88f">YT</a> <small>${h.date}</small></li>`;
    });
    html += "</ol>";
    if (hist.length > MAX_HIST) {
        html += `<div style="color:#ffaa44;margin-top:1em;">Wyświetlono ostatnie ${MAX_HIST} pozycji z ${hist.length}.</div>`;
    }

    // status API
    const currentApiKey = localStorage.getItem("ytUserApiKey");
    const isCustomKey = currentApiKey && currentApiKey.length > 20;

    html += `<div style="margin-top:2em;padding:1em;background:#2a2a2a;border-radius:8px;border-left:4px solid ${isCustomKey ? '#28a745' : '#ffd700'};">`;
    html += `<h4 style="margin:0 0 0.5em 0;color:#fff;">🔑 Status klucza API:</h4>`;
    if (isCustomKey) {
        html += `<p style="color:#78db78;margin:0 0 0.5em 0;">✅ Używasz własnego klucza API</p>`;
        const maskedKey = `${currentApiKey.substring(0, 3)}${'*'.repeat(30)}${currentApiKey.slice(-3)}`;
        html += `<p style="color:#ccc;margin:0;font-family:monospace;font-size:0.9em;">Klucz: ${maskedKey}</p>`;
    } else {
        html += `<p style="color:#ffd700;margin:0;">⚠️ Brak klucza API</p>`;
        html += `<p style="color:#aaa;margin:0;font-family:monospace;font-size:0.9em;">Aplikacja wymaga klucza do działania</p>`;
    }
    html += `</div>`;

    // Akcje
    html += `<div style="margin-top:1.5em;display:flex;gap:0.8em;flex-wrap:wrap;justify-content:center;">`;
    html += `<button onclick='closeModal()' style='padding:0.5em 1em;font-size:1.1em;background:#6c757d;color:#fff;border:none;border-radius:7px;'>Zamknij</button>`;
    html += `<button onclick='clearHistory()' style='padding:0.5em 1em;font-size:1.1em;background:#dc3545;color:#fff;border:none;border-radius:7px;'>Wyczyść historię</button>`;
    html += `<button id='clear-cache-btn-modal' style='padding:0.5em 1em;font-size:1.1em;background:#a22;color:#fff;border:none;border-radius:7px;'>🧹 Wyczyść cache</button>`;
    html += `<button id='remove-api-key-btn-modal' style='padding:0.5em 1em;font-size:1.1em;background:#888;color:#fff;border:none;border-radius:7px;'>🗝️ Usuń API key</button>`;
    html += `</div>`;

    modal(html);

    // Dodaj obsługę przycisków Wyczyść cache i Usuń API key
    setTimeout(() => {
        const cacheBtn = document.getElementById('clear-cache-btn-modal');
        if (cacheBtn) {
            cacheBtn.onclick = function() {
                if (confirm("Czy na pewno wyczyścić cache lokalny aplikacji (kolejka, historia, kanały)? Klucz API zostaje!")) {
                    clearAppCacheNoApiKey();
					setHistoria([]);
					resetPlayerAndQueue();
                    showDebug("Cache został wyczyszczony (API KEY zostaje)", "ok");
                    showFullHistory();
                }
            };
        }
        const apiKeyBtn = document.getElementById('remove-api-key-btn-modal');
        if (apiKeyBtn) {
            apiKeyBtn.onclick = function() {
                if (confirm("Czy na pewno usunąć klucz API?")) {
                    localStorage.removeItem("ytUserApiKey");
                    closeModal();
                    showDebug("Klucz API został usunięty!", "warn");
                    setTimeout(() => location.reload(), 1000);
                }
            };
        }
    }, 100);
}

function clearHistory() {
    if (confirm("Czy na pewno wyczyścić całą historię oglądania?")) {
        setHistoria([]);
        closeModal();
        showDebug("Historia została wyczyszczona", "ok");
    }
}

// ========== Keyboard Help ==========
function showKeyboardHelp() {
    const helpHtml = `
        <h3>⌨️ Skróty klawiszowe</h3>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:0.5em;font-family:monospace;font-size:1.1em;">
            <b>SPACJA</b><span>Play/Pause</span>
            <b>→</b><span>Następny film</span>
            <b>↑</b><span>Głośniej (+5%)</span>
            <b>↓</b><span>Ciszej (-5%)</span>
            <b>M</b><span>Mute/Unmute</span>
            <b>H</b><span>Ta pomoc</span>
        </div>
        <p style="margin-top:1em;color:#bbb;font-size:0.9em;">💡 Na telefonie: przesuń palcem w lewo na filmie aby usunąć</p>
        <button onclick="closeModal()" style="margin-top:1em;padding:0.5em 1em;">OK</button>
    `;
    modal(helpHtml);
}

// ========== Modal ==========
function modal(contentHtml) {
    if (document.getElementById("modal-spz")) return;
    let bg = document.createElement("div");
    bg.id = "modal-spz";
    bg.style = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:#111d;z-index:9998;display:flex;align-items:center;justify-content:center;";
    let box = document.createElement("div");
    box.style = "background:#23242a;padding:2.5em 3em;border-radius:13px;max-width:1200px;width:95vw;max-height:92vh;overflow:auto;color:#fff;box-shadow:0 0 40px #000c;";
    box.innerHTML = contentHtml;
    bg.appendChild(box);
    bg.onclick = e=>{if(e.target===bg) closeModal();}
    document.body.appendChild(bg);
}
function closeModal() {
    let m = document.getElementById("modal-spz");
    if (m) m.remove();
}

// ========== Player ==========
let sessionPlayed = 0;
let ytPlayer = null;
function getGlobalVolume() {
    let v = parseInt(localStorage.getItem("ytGlobalVol")||"10",10);
    if (isNaN(v) || v<0 || v>100) v = 10;
    return v;
}
function setGlobalVolume(val) {
    val = Math.max(0, Math.min(100, parseInt(val,10)||10));
    localStorage.setItem("ytGlobalVol", val);
    document.getElementById("volume-range").value = val;
    document.getElementById("volume-value").innerText = val+"%";
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(val);
}
document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("volume-range").value = getGlobalVolume();
    document.getElementById("volume-value").innerText = getGlobalVolume()+"%";
    document.getElementById("volume-range").oninput = function(e) {
        setGlobalVolume(e.target.value);
    };
});

// Zmieniona funkcja playFromQueue
function playFromQueue(idx = 0, tried = 0) {
    const queue = getQueue();
    if (!queue.length) {
        document.getElementById("player").innerHTML = "<div style='color:#ffb; font-size:1.12em; text-align:center; padding:1em 0;'>Brak dostępnych filmów do odtworzenia w kolejce!</div>";
        localStorage.removeItem("ytQueuePlaying");
        showDebug("Brak dostępnych filmów w kolejce.", "warn");
        renderQueue();
        return;
    }
    if (idx === null || idx >= queue.length) {
        if (isRepeatMode() && queue.length && tried < 2) {
            playFromQueue(0, tried + 1);
            return;
        } else {
            document.getElementById("player").innerHTML = "<i>Koniec kolejki!</i>";
            localStorage.removeItem("ytQueuePlaying");
            showDebug("To był ostatni film.", "warn");
            renderQueue();
            return;
        }
    }

    stopProgressTracking();
    loadYTApi();
    let videoId = queue[idx].id;
    document.getElementById("player").innerHTML = `<div id="yt-player"></div>`;

    setTimeout(() => {
        ytPlayer = new YT.Player('yt-player', {
            height: '185',
            width: '325',
            videoId: videoId,
            playerVars: { autoplay: 1 },
            events: {
                onReady: function (event) {
                    event.target.setVolume(getGlobalVolume());
                    showDebug(`🎵 Ładowanie: <b>${queue[idx].title}</b>`, "ok");
                    startProgressTracking();
                },
                onError: function (event) {
                    stopProgressTracking();
                    removeFromQueue(videoId);
                    showDebug("Film niedostępny, usuwam z kolejki i przeskakuję dalej...", "warn");
                    playFromQueue(idx, tried + 1);
                },
                onStateChange: function (event) {
                    if (event.data === YT.PlayerState.PLAYING) {
                        event.target.setVolume(getGlobalVolume());
                        startProgressTracking();
                    }
                    if (event.data === YT.PlayerState.PAUSED) {
                        const queue = getQueue();
                        const playingIdx = Number(localStorage.getItem("ytQueuePlaying"));
                        if (queue[playingIdx]) {
                            showDebug(`⏸️ Paused: <b>${queue[playingIdx].title}</b>`, "warn");
                        }
                        if (progressInterval) clearInterval(progressInterval);
                    }
                    if (event.data === YT.PlayerState.ENDED) {
                        stopProgressTracking();
                        const nextIdx = getNextQueueIndex(idx);
                        playFromQueue(nextIdx, 0);
                    }
                }
            }
        });
    }, 400);

    localStorage.setItem("ytQueuePlaying", idx);
    sessionPlayed++;
    saveHistory(queue[idx]);
    renderStats();
    renderQueue();
    if (document.getElementById("current-title")) document.getElementById("current-title").innerText = queue[idx].title;
}

function renderChannels() {
    const div = document.getElementById('channels');
    const chs = getChannels();
    if (chs.length === 0) {
        div.innerHTML = "";
        return;
    }
    
    div.innerHTML = '';
    const queue = getQueue();
    const watchedIds = getWatchedIds();
    let filmsByChannel = JSON.parse(localStorage.getItem("ytLastFilmsByChannel") || "{}");
    
    chs.forEach((ch, idx) => {
        const count = queue.filter(v => v.channel === ch.nazwa).length;
        const allVideos = filmsByChannel[ch.id] || [];
        const currentQueue = queue.map(v => v.id);
        const next20 = allVideos.filter(vid =>
            !watchedIds.includes(vid.id) && !currentQueue.includes(vid.id)
        ).slice(0, 20);
        
        let box = document.createElement('div');
        box.className = 'channel-box';

        const availableCount = allVideos.length;
        const unwatchedCount = allVideos.filter(vid => !watchedIds.includes(vid.id)).length;

        // Nowy układ: górny rząd (statystyki + przyciski), dolny rząd (nazwa kanału)
        box.innerHTML = `
            <div class="channel-row-top">
                <div class="channel-row-stats">
                    <span class="channel-count">${count} w kolejce</span>
                    <span class="channel-available">${unwatchedCount}/${availableCount} dostępnych</span>
                </div>
                <div class="channel-row-actions">
                    ${next20.length > 0 ? `<button class="add-next-20-icon" title="Dodaj kolejne ${next20.length} do kolejki"><span>+${next20.length}</span></button>` : ""}
                    <button class="remove-channel-btn" title="Usuń kanał">🗑️</button>
                </div>
            </div>
            <div class="channel-row-title">
                <span class="channel-title">${ch.nazwa}</span>
            </div>
        `;

        if (next20.length > 0) {
            box.querySelector('.add-next-20-icon').onclick = () => addNext20FromChannel(ch.id, ch.nazwa);
        }
        box.querySelector('.remove-channel-btn').onclick = () => {
            if (confirm(`Czy na pewno usunąć kanał "${ch.nazwa}"?`)) removeChannel(ch.id);
        };

        div.appendChild(box);
    });
}

function loadYTApi() {
    if (window.YT) return;
    let tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
}
window.onYouTubeIframeAPIReady = function() {};

// ========== Kanały ==========


function addNext20FromChannel(channelId, channelName) {
    const watched = getWatchedIds();
    const currentQueue = getQueue().map(v => v.id);
    let filmsByChannel = JSON.parse(localStorage.getItem("ytLastFilmsByChannel") || "{}");
    let allVideos = filmsByChannel[channelId] || [];
    let toAdd = allVideos.filter(vid => !watched.includes(vid.id) && !currentQueue.includes(vid.id)).slice(0, 20);
    if (toAdd.length === 0) {
        showDebug("Nie znaleziono kolejnych nieobejrzanych filmów z tego kanału!", "error");
        return;
    }
    let queue = getQueue();
    queue.push(...toAdd);
    setQueue(queue);
    renderQueue();
    showDebug(`Dodano ${toAdd.length} kolejnych filmów z kanału "${channelName}"!`, "ok");
}

// ========== Stats ==========
function renderStats() {
    const queue = getQueue(), chs = getChannels();
    let stat = `<b>Kanały:</b> ${chs.length} &nbsp;|&nbsp; <b>Kolejka:</b> ${queue.length} &nbsp;|&nbsp; <b>Odtworzone w sesji:</b> ${sessionPlayed}`;
    document.getElementById('stats-row').innerHTML = stat;
}

// ========== Renderuj wszystko ==========
function renderAll() {
    renderChannels();
    renderQueue();
    renderHistoria();
    renderStats();
    document.title = "🦉 Kolejka YouTube";
    if(document.getElementById('program-header')) document.getElementById('program-header').innerText = "🦉 (NZB) Nocna Zmaza Bluesa v.89";
    updateModeButtons();
    if (localStorage.getItem("ytQueuePlaying")) playFromQueue(parseInt(localStorage.getItem("ytQueuePlaying")));
    
    // ⭐ ZMIANA: Sprawdź API key i pokaż odpowiednią wiadomość
    if (!checkAPIKeyValid()) {
        showDebug(`🔑 <span style="color:#ffd700;font-weight:bold;cursor:pointer;text-decoration:underline;" onclick="showAPIKeySetupModal()">NALEŻY WPROWADZIĆ API KEY - KLIKNIJ TUTAJ</span>`, "warn");
    } else {
        showDebug("Ready, Nocna Zmaza Bluesa v.89 🦉", "ok");
    }
}

// ⭐ DODAJ obsługę klikalnego tekstu w showDebug
function showDebug(msg, type="ok") {
    const dbg = document.getElementById('debug-row');
    dbg.innerHTML = msg;
    dbg.className = "footer-row";
    if (type === "ok") dbg.classList.add("debug-ok");
    if (type === "warn") dbg.classList.add("debug-warn");
    if (type === "error") dbg.classList.add("debug-err");
    
    // Dodaj pointer cursor dla klikalnych elementów
    if (msg.includes('onclick=')) {
        dbg.style.cursor = 'pointer';
    } else {
        dbg.style.cursor = 'default';
    }
}


// ⭐ status klikalny
function showStatusDebug() {
    // Test API
    let apiOk = checkAPIKeyValid();
    let filesOk = true;
    let testKeys = ["ytQueue", "ytHistoria", "ytChannels"];
    try {
        testKeys.forEach(k => {
            let v = localStorage.getItem(k);
            if (k !== "ytQueuePlaying" && v && v !== "null") {
                JSON.parse(v);
            }
        });
    } catch(e) {
        filesOk = false;
    }

    // localStorage usage
    const maxLS = 5 * 1024 * 1024;
    const lsSize = JSON.stringify(localStorage).length;
    let lsState = "OK";
    let lsColor = "#00ee44";
    if (lsSize > maxLS * 0.9) {
        lsState = "CRITICAL";
        lsColor = "#ff4444";
    } else if (lsSize > maxLS * 0.7) {
        lsState = "WARN";
        lsColor = "#ffd700";
    }

    let browser = getShortBrowserInfo ? getShortBrowserInfo() : (navigator.userAgent || "browser");
	
	const version = "v.89";
    let msg = `
        <span style="color:#fff;font-weight:600;">API:<span style="color:#1cff6a;">OK</span></span>
        <span style="color:#fff;font-weight:600;">&nbsp;| PLIKI:<span style="color:#1cff6a;">OK</span></span>
        <span style="color:#fff;font-weight:600;">&nbsp;| ${version} | local storage:<span style="color:#1cff6a;">${lsSize}B/</span>=<span style="color:#1cff6a;">5MB</span></span>
        <span style="color:#fff;font-weight:600;">&nbsp;| browser:<span style="color:#1cff6a;">${browser}</span></span>
    `;
    showDebug(msg, (apiOk && filesOk && lsState === "OK") ? "ok" : (apiOk && filesOk ? "warn" : "error"));
}

// ⭐ AKTUALIZUJ saveManualKey żeby odświeżył wiadomość po zapisaniu
function saveManualKey() {
    const input = document.getElementById('manual-key-input');
    const key = input.value.trim();
    
    if (!key || key.length < 20) {
        showDebug("❌ Klucz wydaje się niepoprawny (za krótki)", "error");
        return;
    }
    
    showDebug("🔄 Testuję klucz API...", "warn");
    
    fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=${key}`)
    .then(r => r.json())
    .then(data => {
        if (data && data.items) {
            localStorage.setItem("ytUserApiKey", key);
            apiKey = key;
            closeModal();
            showDebug("✅ Klucz API zapisany i przetestowany!", "ok");
            updateFormState(); // Odblokuj formularz
            
            // ⭐ Po 2 sekundach pokaż Ready message
            setTimeout(() => {
                showDebug("Ready, Nocna Zmaza Bluesa v.89 🦉", "ok");
            }, 2000);
        } else {
            const errorMsg = data?.error?.message || 'Nieznany błąd';
            showDebug(`❌ Klucz nie działa: ${errorMsg}`, "error");
        }
    })
    .catch(err => {
        showDebug(`❌ Błąd testowania: ${err.message}`, "error");
    });
}
document.addEventListener('DOMContentLoaded', renderAll);

// ========== Utility: Extract Video ID ==========
function extractVideoId(input) {
    let id = input.trim();
    if (/^[a-zA-Z0-9_-]{10,}$/.test(id)) return id;
    let m = id.match(/(?:v=|\/embed\/|\.be\/)([a-zA-Z0-9_-]{10,})/);
    return m ? m[1] : null;
}

// ========== Add/Import/Export ==========
document.addEventListener("DOMContentLoaded", function() {
    document.getElementById('yt-universal-form').onsubmit = function(e) {
        e.preventDefault();
        if (!checkAPIKeyValid()) {
            showAPIKeySetupModal();
            return;
        }
        let input = document.getElementById('yt_universal_input').value.trim();
        handleUniversalInput(input);
        document.getElementById('yt_universal_input').value = '';
    };
    document.getElementById('export-queue-btn').onclick = exportQueue;
    document.getElementById('import-queue-btn').onclick = () => document.getElementById('import-queue-input').click();
    document.getElementById('import-queue-input').onchange = importQueue;
});

function exportQueue() {
    const queue = getQueue();
    const blob = new Blob([JSON.stringify(queue, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "moja_kolejka_youtube.json";
    a.click();
    URL.revokeObjectURL(url);
}

function importQueue(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const arr = JSON.parse(e.target.result);
            if (Array.isArray(arr)) {
                setQueue(arr);
                showDebug("Zaimportowano playlistę!", "ok");
            } else {
                showDebug("Nieprawidłowy plik!", "error");
            }
        } catch {
            showDebug("Błąd odczytu pliku!", "error");
        }
    }
    reader.readAsText(file);
}

// ========== Tryby kolejki ==========
let queueMode = localStorage.getItem("ytQueueMode") || "classic";
function setQueueMode(mode) {
    queueMode = mode;
    localStorage.setItem("ytQueueMode", mode);
    updateModeButtons();
    showDebug(`Tryb zmieniony na: ${mode}`, "ok");
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById("mode-classic").onclick = ()=>setQueueMode("classic");
    document.getElementById("mode-alternate").onclick = ()=>setQueueMode("alternate");
    document.getElementById("mode-random").onclick = ()=>setQueueMode("random");
    updateModeButtons();
});

// ========== Universal input ==========
async function handleUniversalInput(input) {
    if (!checkAPIKeyValid()) {
        showAPIKeySetupModal();
        return;
    }
    input = input.trim();

    // --------- KANAŁ: /@nazwa (z końcówkami typu /videos, /streams, itd. lub bez) ---------
    let atMatch = input.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/@([a-zA-Z0-9_.-]+)(?:[\/?].*)?$/i)
        || input.match(/^@([a-zA-Z0-9_.-]+)$/);
    if (atMatch) {
        // obsłuż np. @Loading-Nextcast oraz linki z końcówkami
        const usernameRaw = atMatch[1];
        const username = usernameRaw.split('/')[0].split('?')[0];
        // Szukaj kanału po nazwie użytkownika
        const data = await safeYTApiCall(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${apiKey}`,
            `search_${username}`
        );
        let found = null;
        if (data?.items?.length) {
            found = data.items.find(item => {
                // sprawdź czy customUrl istnieje i pasuje
                if (item.snippet?.customUrl && item.snippet.customUrl.toLowerCase() === username.toLowerCase()) return true;
                // sprawdź czy channelTitle po usunięciu znaków specjalnych pasuje do username
                const normalized = s => s.replace(/[^a-z0-9]/gi,"").toLowerCase();
                if (item.snippet?.channelTitle && normalized(item.snippet.channelTitle) === normalized(username)) return true;
                // sprawdź czy ID kanału się zgadza (czasem username == channelId)
                if (item.snippet?.channelId && item.snippet.channelId === username) return true;
                if (item.id?.channelId && item.id.channelId === username) return true;
                return false;
            });
            // Jeśli nie znaleziono idealnego trafienia, weź pierwszy wynik jako fallback
            if (!found) found = data.items[0];
        }
        // Jeśli coś znaleziono, pobierz szczegóły kanału po ID (pewniak!)
        if (found) {
            const channelId = found.snippet?.channelId || found.id?.channelId;
            // pobierz szczegóły kanału (nazwa, itd.)
            const chData = await safeYTApiCall(
                `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${apiKey}`,
                `channel_${channelId}`
            );
            const chName = chData?.items?.[0]?.snippet?.title || username;
            addChannel(channelId, chName);
            await fetchVideosFromChannel(channelId, chName);
            showDebug(`Kanał <b>${chName}</b> dodany!`, "ok");
        } else {
            showDebug('Nie znaleziono kanału! Spróbuj linku w formacie /channel/UC... lub /@nazwa', "error");
        }
        return;
    }

    // --------- KANAŁ: /channel/UC... lub samo UC... ---------
    let chMatch = input.match(/(?:youtube\.com\/)?channel\/(UC[A-Za-z0-9_-]{20,})/i) || input.match(/^(UC[A-Za-z0-9_-]{20,})$/);
    if (chMatch) {
        const channelId = chMatch[1];
        const data = await safeYTApiCall(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${apiKey}`,
            `channel_${channelId}`
        );
        const chName = data?.items?.[0]?.snippet?.title || channelId;
        addChannel(channelId, chName);
        await fetchVideosFromChannel(channelId, chName);
        showDebug(`Kanał <b>${chName}</b> dodany!`, "ok");
        return;
    }

    // --------- KANAŁ: /c/NAZWA lub /user/NAZWA ---------
    let customMatch = input.match(/youtube\.com\/(c|user)\/([a-zA-Z0-9_.-]+)/i);
    if (customMatch) {
        const customUrl = customMatch[2];
        const data = await safeYTApiCall(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(customUrl)}&key=${apiKey}`,
            `search_${customUrl}`
        );
        let found = null;
        if (data?.items?.length) {
            found = data.items.find(item =>
                (item.snippet?.customUrl && item.snippet.customUrl.toLowerCase() === customUrl.toLowerCase()) ||
                (item.snippet?.channelTitle && item.snippet.channelTitle.replace(/\s/g,"").toLowerCase() === customUrl.replace(/\s/g,"").toLowerCase())
            );
            if (!found) found = data.items[0];
        }
        if (found) {
            const channelId = found.snippet?.channelId || found.id?.channelId;
            const chData = await safeYTApiCall(
                `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${apiKey}`,
                `channel_${channelId}`
            );
            const chName = chData?.items?.[0]?.snippet?.title || customUrl;
            addChannel(channelId, chName);
            await fetchVideosFromChannel(channelId, chName);
            showDebug(`Kanał <b>${chName}</b> dodany!`, "ok");
        } else {
            showDebug('Nie znaleziono kanału! Spróbuj linku w formacie /channel/UC... lub /@nazwa', "error");
        }
        return;
    }

    // --------- PLAYLISTA: link lub ID ---------
    let playlistMatch = input.match(/[?&]list=([A-Za-z0-9_-]+)/) || input.match(/^PL[A-Za-z0-9_-]+$/);
    if (playlistMatch) {
        let playlistId = playlistMatch[1] || playlistMatch[0];
        const data = await safeYTApiCall(
            `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`,
            `playlist_${playlistId}`
        );
        if (data?.items?.[0]) {
            let plTitle = data.items[0].snippet.title;
            if (confirm(`Znaleziono playlistę: "${plTitle}".\nDodać wszystkie filmy do kolejki?`)) {
                fetchPlaylistVideosToQueue(playlistId, plTitle);
            }
        } else {
            showDebug('Nie znaleziono playlisty!', "error");
        }
        return;
    }

    // --------- FILM: link lub ID ---------
    let vid = extractVideoId(input);
    if (vid) {
        const cacheKey = `video_${vid}`;
        const data = await safeYTApiCall(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${vid}&key=${apiKey}`,
            cacheKey
        );
        if (data?.items?.[0]) {
            let snippet = data.items[0].snippet;
            let film = {
                id: vid,
                title: snippet.title,
                channel: snippet.channelTitle || "nieznany"
            };
            addToQueue(film);
            saveHistory(film);
            showDebug("Dodano film do kolejki i historii!", "ok");
        } else {
            showDebug('Nie znaleziono filmu!', "error");
        }
        return;
    }

    showDebug('Nieprawidłowy link lub ID! Obsługiwane: film, kanał (channel/UC..., @nazwa, /c/, /user/), playlista', "warn");
}

async function fetchVideosFromChannel(channelId, channelName) {
    let allVideos=[]; let pageToken=''; let maxVideos=100; let fetched=0;
    do {
        let url=`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=50&key=${apiKey}`;
        if (pageToken) url+=`&pageToken=${pageToken}`;
        const data=await safeYTApiCall(url,`channelVids_${channelId}_${pageToken}`);
        if (!data?.items) break;
        for (const item of data.items) {
            if (item.id && item.id.videoId && item.snippet) {
                allVideos.push({id:item.id.videoId,title:item.snippet.title,channel:channelName});
                fetched++; if (fetched>=maxVideos) break;
            }
        }
        pageToken=data.nextPageToken;
    } while (pageToken && fetched<maxVideos);
    let filmsByChannel=JSON.parse(localStorage.getItem("ytLastFilmsByChannel")||"{}");
    filmsByChannel[channelId]=allVideos;
    localStorage.setItem("ytLastFilmsByChannel",JSON.stringify(filmsByChannel));
    renderChannels();
    showDebug(`Zapisano ${allVideos.length} filmów z kanału <b>${channelName}</b>!`, "ok");
}
async function fetchPlaylistVideosToQueue(playlistId, plTitle) {
    let q = getQueue();
    let added = 0; let maxVideos = 1000; let allVideos = [];
    async function fetchPage(pageToken) {
        let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}`;
        if (pageToken) url += `&pageToken=${pageToken}`;
        const data = await safeYTApiCall(url, `playlist_items_${playlistId}_${pageToken || 'first'}`);
        if (!data?.items) { showDebug('Nie udało się pobrać playlisty!', "error"); return; }
        data.items.forEach(item => {
            if (item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId) {
                allVideos.push({id:item.snippet.resourceId.videoId,title:item.snippet.title,channel:item.snippet.videoOwnerChannelTitle||plTitle});
            }
        });
        if (data.nextPageToken && allVideos.length < maxVideos) await fetchPage(data.nextPageToken);
        else {
            let before = q.length;
            allVideos.forEach(video => { if (!q.find(e=>e.id===video.id)) { q.push(video); added++; } });
            setQueue(q);
            showDebug(`Dodano ${added} z ${allVideos.length} filmów z playlisty "${plTitle}".`, "ok");
        }
    }
    await fetchPage("");
}

// ========== Stars Background Effect ==========
document.addEventListener('DOMContentLoaded', function() {
    let starsBg = null;
    let stars = [];
    const STAR_COUNT = 80;

    function createStarsBg() {
        if (starsBg) return;
        starsBg = document.createElement('div');
        starsBg.className = 'stars-bg-effect';
        document.body.insertBefore(starsBg, document.body.firstChild);
        stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            const star = document.createElement('div');
            const size = Math.random() * 2 + 1;
            star.className = 'star-effect-bg';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.width = size + 'px';
            star.style.height = size + 'px';
            star.style.opacity = '0';
            starsBg.appendChild(star);
            stars.push(star);
        }
    }

    function showStarsSubtly() {
        if (!starsBg) createStarsBg();
        let order = [...Array(STAR_COUNT).keys()].sort(() => Math.random() - 0.5);
        order.forEach((idx, i) => {
            setTimeout(() => {
                stars[idx].style.transition = 'opacity 0.8s';
                stars[idx].style.opacity = (Math.random() * 0.4 + 0.3).toString();
            }, i * 18 + Math.random() * 40);
        });
    }

    function hideStarsSubtly(removeAfter = true) {
        if (!starsBg) return;
        let order = [...Array(STAR_COUNT).keys()].sort(() => Math.random() - 0.5);
        order.forEach((idx, i) => {
            setTimeout(() => {
                stars[idx].style.transition = 'opacity 1.2s';
                stars[idx].style.opacity = '0';
            }, i * 18 + Math.random() * 40);
        });
        if (removeAfter) {
            setTimeout(() => {
                if (starsBg) starsBg.remove();
                starsBg = null;
                stars = [];
            }, STAR_COUNT * 18 + 1500);
        }
    }

    createStarsBg();
    showStarsSubtly();

    let starsOn = true;
    const toggleBtn = document.getElementById('toggle-stars-btn');
    if (toggleBtn) {
        toggleBtn.style.background = '#2a4';
        toggleBtn.addEventListener('click', function() {
            starsOn = !starsOn;
            if (starsOn) {
                toggleBtn.style.background = '#2a4';
                createStarsBg();
                showStarsSubtly();
            } else {
                toggleBtn.style.background = '#262';
                hideStarsSubtly(true);
            }
        });
    }
});

// ========== Helper functions ==========
function isRepeatMode() {
    return document.getElementById('queue-repeat')?.checked || false;
}
