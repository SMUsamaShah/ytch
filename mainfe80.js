// ── Config ────────────────────────────────────────────────────────────────────
// Replace with the raw URL to your pool.json Gist file
const POOL_GIST_URL = "https://gist.githubusercontent.com/SMUsamaShah/63a62ae38897f7e1691c78811470e97a/raw/pool.json";

// ── DOM refs ──────────────────────────────────────────────────────────────────
let staticNoise = document.querySelector(".static-noise");
let smpte = document.querySelector(".smpte");
let channelName = document.querySelector(".channel-name");
let muteIcon = document.querySelector(".muteIcon");
let control = document.querySelector(".control");
let controlT1 = document.querySelector(".control .t-1");
let controlT2 = document.querySelector(".control .t-2");
let powerScreen = document.querySelector(".power-screen");
let info = document.querySelector(".info");
let guide = document.querySelector(".guide");
let videoIdElement = document.querySelector(".videoIdElement .text");
let volumeSteps = document.querySelector(".volume-steps .steps");
let volumeStepsContainer = document.querySelector(".volume-steps");

// ── State ─────────────────────────────────────────────────────────────────────
let player, playingNow, volume;
let channelNumber = 1;
let volumeFadeoutTimer, channelNameFadeoutTimer, controllerFadeoutTimer, numberInputTimer;
let isMin = false, isMuted = true, isOn = true, showInfo = false, showGuide = false, isControlSwipe = false;
let touchStartX, touchStartY, touchMoveX, touchMoveY, controlCurrPos = 0, distanceMoved, channelNumberInput = "", lastChannelNumber;

let pool = {};
let currentPlaylist = [];
let currentPlaylistIdx = 0;
let currentSlotName = "all";

// ── Persistence ───────────────────────────────────────────────────────────────
if (localStorage.getItem("storedChannelNumber") === null) {
    channelNumber = 1;
    localStorage.setItem("storedChannelNumber", channelNumber);
} else {
    channelNumber = Number(localStorage.getItem("storedChannelNumber"));
}

if (localStorage.getItem("storedLastChannelNumber") === null) {
    lastChannelNumber = channelNumber;
    localStorage.setItem("storedLastChannelNumber", lastChannelNumber);
} else {
    lastChannelNumber = Number(localStorage.getItem("storedLastChannelNumber"));
}

if (localStorage.getItem("storedVolume") === null) {
    volume = 70;
    localStorage.setItem("storedVolume", 70);
} else {
    volume = Number(localStorage.getItem("storedVolume"));
}

// ── Scheduling helpers ────────────────────────────────────────────────────────
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function seededShuffle(arr, seed) {
    const rng = mulberry32(seed);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function strToSeed(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return h;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getCurrentSlot(ch) {
    if (!pool[ch] || !pool[ch].slots) return null;
    const now = new Date();
    const hhmm = now.getHours() * 60 + now.getMinutes();
    for (const slot of pool[ch].slots) {
        const [sh, sm] = slot.start.split(":").map(Number);
        const [eh, em] = slot.end.split(":").map(Number);
        if (hhmm >= sh * 60 + sm && hhmm < eh * 60 + em) return slot;
    }
    return null;
}

function getDailyPlaylist(ch, slot) {
    if (!pool[ch] || !pool[ch].pool) return [];
    let videos = pool[ch].pool;
    if (slot && (slot.minDuration !== null || slot.maxDuration !== null)) {
        const filtered = videos.filter(v => {
            if (slot.minDuration !== null && v.duration < slot.minDuration) return false;
            if (slot.maxDuration !== null && v.duration > slot.maxDuration) return false;
            return true;
        });
        if (filtered.length > 0) videos = filtered;
    }
    if (videos.length === 0) return [];
    const slotName = slot ? slot.name : "all";
    return seededShuffle(videos, strToSeed(`${todayStr()}-${ch}-${slotName}`));
}

function getPlaylistIdx(ch, slotName) {
    return Number(localStorage.getItem(`pl_${ch}_${slotName}`) || 0);
}

function savePlaylistIdx(ch, slotName, idx) {
    localStorage.setItem(`pl_${ch}_${slotName}`, idx);
}

// ── Pool loading ──────────────────────────────────────────────────────────────
function loadPool() {
    fetch(POOL_GIST_URL + "?t=" + Date.now())
        .then(r => r.json())
        .then(data => {
            pool = data;
            playChannel(channelNumber, false);
        })
        .catch(() => {
            smpte.style.opacity = 1;
        });
}

// ── Playback ──────────────────────────────────────────────────────────────────
function startChannel(ch) {
    if (!pool[ch]) { smpte.style.opacity = 1; return; }
    const slot = getCurrentSlot(ch);
    if (!slot && pool[ch].slots && pool[ch].slots.length > 0) {
        // Outside all slot windows for this channel
        smpte.style.opacity = 1;
        return;
    }
    currentSlotName = slot ? slot.name : "all";
    currentPlaylist = getDailyPlaylist(ch, slot);
    currentPlaylistIdx = getPlaylistIdx(ch, currentSlotName);
    if (currentPlaylistIdx >= currentPlaylist.length) currentPlaylistIdx = 0;
    if (currentPlaylist.length === 0) { smpte.style.opacity = 1; return; }
    smpte.style.opacity = 0;
    playingNow = currentPlaylist[currentPlaylistIdx].id;
    player.loadVideoById(playingNow);
    player.setVolume(volume);
    player.setPlaybackRate(1);
}

function advancePlaylist() {
    currentPlaylistIdx = (currentPlaylistIdx + 1) % currentPlaylist.length;
    savePlaylistIdx(channelNumber, currentSlotName, currentPlaylistIdx);
    // Re-check slot in case time boundary crossed
    const slot = getCurrentSlot(channelNumber);
    const slotName = slot ? slot.name : "all";
    if (slotName !== currentSlotName) {
        currentSlotName = slotName;
        currentPlaylist = getDailyPlaylist(channelNumber, slot);
        currentPlaylistIdx = getPlaylistIdx(channelNumber, currentSlotName);
        if (currentPlaylistIdx >= currentPlaylist.length) currentPlaylistIdx = 0;
    }
    if (currentPlaylist.length === 0) { smpte.style.opacity = 1; return; }
    playingNow = currentPlaylist[currentPlaylistIdx].id;
    player.loadVideoById(playingNow);
    player.setVolume(volume);
    player.setPlaybackRate(1);
}

function playChannel(ch, s) {
    clearTimeout(channelNameFadeoutTimer);
    const channelCount = Object.keys(pool).length || 19;
    if (ch > 0 && (Object.keys(pool).length === 0 || ch <= channelCount)) {
        if (localStorage.getItem("storedChannelNumber") != ch) {
            channelName.textContent = ch < 10 ? "CH 0" + ch : "CH " + ch;
            channelName.style.opacity = 1;
            lastChannelNumber = channelNumber;
            channelNumber = ch;
            localStorage.setItem("storedLastChannelNumber", lastChannelNumber);
            localStorage.setItem("storedChannelNumber", ch);
        }
        control.style.display = "flex";
        smpte.style.opacity = 0;
        if (Object.keys(pool).length > 0) {
            startChannel(ch);
        } else if (s) {
            loadPool();
        } else {
            smpte.style.opacity = 1;
        }
    } else {
        channelName.textContent = "INVALID";
        channelNameFadeoutTimer = setTimeout(() => { channelName.style.opacity = 0; }, 3000);
    }
}

// ── YouTube IFrame API ────────────────────────────────────────────────────────
var scriptUrl = 'https:\/\/www.youtube.com\/s\/player\/d2e656ee\/www-widgetapi.vflset\/www-widgetapi.js'; try { var ttPolicy = window.trustedTypes.createPolicy("youtube-widget-api", { createScriptURL: function (x) { return x } }); scriptUrl = ttPolicy.createScriptURL(scriptUrl) } catch (e) { } var YT; if (!window["YT"]) YT = { loading: 0, loaded: 0 }; var YTConfig; if (!window["YTConfig"]) YTConfig = { "host": "https://www.youtube.com" };
if (!YT.loading) {
    YT.loading = 1; (function () {
        var l = []; YT.ready = function (f) { if (YT.loaded) f(); else l.push(f) }; window.onYTReady = function () { YT.loaded = 1; var i = 0; for (; i < l.length; i++)try { l[i]() } catch (e) { } }; YT.setConfig = function (c) { var k; for (k in c) if (c.hasOwnProperty(k)) YTConfig[k] = c[k] }; var a = document.createElement("script"); a.type = "text/javascript"; a.id = "www-widgetapi-script"; a.src = scriptUrl; a.async = true; var c = document.currentScript; if (c) {
            var n = c.nonce || c.getAttribute("nonce"); if (n) a.setAttribute("nonce",
                n)
        } var b = document.getElementsByTagName("script")[0]; b.parentNode.insertBefore(a, b)
    })()
};

function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: 400,
        width: 700,
        playerVars: {
            'playsinline': 1,
            'disablekb': 1,
            'enablejsapi': 1,
            'iv_load_policy': 3,
            'cc_load_policy': 0,
            'controls': 0,
            'rel': 0,
            'autoplay': 1,
            'mute': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onAutoplayBlocked': onAutoplayBlocked,
            'onError': onErrorOccured
        }
    });
    resizePlayer();
    window.addEventListener('resize', function () { resizePlayer(); }, true);
}

function onErrorOccured(event) {
    console.error(event.data);
    // Skip broken videos
    if (currentPlaylist.length > 0) advancePlaylist();
}

function onPlayerReady(event) {
    loadPool();
    control.style.display = "flex";
    if (localStorage.getItem("controlAnimate") === null) {
        controlT1.style.animation = "2s swipeControl";
        controlT2.style.animation = "2s swipeControl";
        localStorage.setItem("controlAnimate", "1");
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === "ArrowUp" || e.key === "ChannelUp")
            switchChannel(1);
        else if (e.key === "ArrowDown" || e.key === "ChannelDown")
            switchChannel(-1);
        else if (e.key === "+" || e.key === "=" || e.key === "ArrowRight")
            changeVolume(5);
        else if (e.key === "-" || e.key === "_" || e.key === "ArrowLeft")
            changeVolume(-5);
        else if (e.key === "m" || e.key === "M")
            toggleMute();
        else if (e.key === " ")
            toggleGuide();
        else if (e.key === "Shift")
            toggleControl();
        else if (e.key === "Enter")
            goToChannel();
        else if (e.key === "f" || e.key === "F")
            toggleFullScreen();
        else if ("0123456789".includes(e.key))
            numberInput(e.key);
    });
}

function onPlayerStateChange(event) {
    staticNoise.style.opacity = 1;
    if (event.data == -1) {
        videoIdElement.innerHTML = "UNSTARTED";
    } else if (event.data == 0) {
        videoIdElement.innerHTML = "ENDED";
        advancePlaylist();
    } else if (event.data == 1) {
        channelNameFadeoutTimer = setTimeout(() => { channelName.style.opacity = 0; }, 3000);
        staticNoise.style.opacity = 0;
        videoIdElement.innerHTML = playingNow;
    } else if (event.data == 2) {
        videoIdElement.innerHTML = "PAUSED";
    } else if (event.data == 3) {
        videoIdElement.innerHTML = "BUFFERING";
    } else if (event.data == 5) {
        videoIdElement.innerHTML = "VIDEO CUED";
    }
}

function onAutoplayBlocked() {
    console.log("Autoplay blocked!");
}

// ── Controls ──────────────────────────────────────────────────────────────────
function resizePlayer() {
    let p = document.querySelector("#player");
    p.style.top = - window.innerHeight * 0.5 + "px";
    p.style.left = (window.innerWidth - Math.min(window.innerHeight * 1.777, window.innerWidth)) / 2 + "px";
    player.setSize(Math.min(window.innerHeight * 1.777, window.innerWidth), window.innerHeight * 2);
}

document.body.addEventListener("touchend", function () {
    control.style.opacity = 1;
    clearTimeout(controllerFadeoutTimer);
});

document.body.addEventListener("mousemove", function (e) {
    if (isMin) {
        control.style.opacity = 1;
        clearTimeout(controllerFadeoutTimer);
        controllerFadeoutTimer = setTimeout(() => { control.style.opacity = 0; }, 3000);
    }
    controlSwipeMove(e.clientX, e.clientY);
});

control.addEventListener("touchstart", (e) => { controlSwipeDown(e.touches[0].clientX, e.touches[0].clientY); });
control.addEventListener("mousedown", (e) => { controlSwipeDown(e.clientX, e.clientY); });
document.addEventListener("touchmove", (e) => { controlSwipeMove(e.touches[0].clientX, e.touches[0].clientY); });
document.addEventListener("touchend", () => { controlSwipeEnd(); });
document.addEventListener("mouseup", () => { controlSwipeEnd(); });

function controlSwipeDown(x, y) {
    if (!isMin) isControlSwipe = true;
    touchStartX = x;
    touchStartY = y;
}

function controlSwipeMove(x, y) {
    if (isControlSwipe) {
        touchMoveX = x;
        touchMoveY = y;
        distanceMoved = (touchMoveX - touchStartX);
        let t = distanceMoved + controlCurrPos;
        if (t > 10) t = 10;
        if (t < -control.offsetWidth - 10) t = -control.offsetWidth - 10;
        controlT1.style.transform = "translateX(" + t + "px)";
        controlT2.style.transform = "translateX(" + t + "px)";
    }
}

function controlSwipeEnd() {
    if (distanceMoved > 20) controlCurrPos = 0;
    if (distanceMoved < -20) controlCurrPos = -control.offsetWidth;
    controlT1.style.transform = "translateX(" + controlCurrPos + "px)";
    controlT2.style.transform = "translateX(" + controlCurrPos + "px)";
    isControlSwipe = false;
}

function toggleMute() {
    if (isOn) {
        if (player.isMuted()) {
            player.unMute();
            isMuted = false;
            muteIcon.src = "icons/volume-2.svg";
            if (volume == 0) volume = 5;
            localStorage.setItem("storedVolume", volume);
            volumeSteps.innerHTML = "";
            for (let i = 0; i < volume; i += 5) volumeSteps.innerHTML += '<div class="step"></div>';
        } else {
            muteIcon.src = "icons/volume-x.svg";
            player.mute();
            isMuted = true;
            volumeSteps.innerHTML = "";
        }
    }
}

function switchChannel(a) {
    if (isOn) {
        const count = Object.keys(pool).length || 19;
        let n = channelNumber + a;
        if (n < 1) n = count;
        if (n > count) n = 1;
        playChannel(Number(n), true);
    }
}

function toggleControl() {
    clearTimeout(controllerFadeoutTimer);
    let min = document.querySelectorAll(".min");
    let w = document.querySelectorAll(".control .w");
    let minimizeImg = document.querySelector(".minimizeImg");
    if (isMin) {
        min.forEach(e => { e.style.display = "flex"; });
        isMin = false;
        minimizeImg.src = "icons/minimize-2.svg";
        control.style.width = "10rem";
        controlT2.style.display = "block";
        controlT2.style.animation = "0";
        w.forEach(e => { e.style.margin = "0 0 0.5rem 0"; });
    } else {
        min.forEach(e => { e.style.display = "none"; });
        minimizeImg.src = "icons/maximize-2.svg";
        control.style.width = "auto";
        controlT2.style.display = "none";
        isMin = true;
        w.forEach(e => { e.style.margin = "0"; });
        controllerFadeoutTimer = setTimeout(() => { control.style.opacity = 0; }, 3000);
    }
}

function togglePower() {
    if (isOn) {
        isOn = false;
        player.pauseVideo();
        powerScreen.style.display = "block";
    } else {
        isOn = true;
        powerScreen.style.display = "none";
        playChannel(channelNumber, true);
    }
}

function toggleInfo() {
    if (showInfo) { showInfo = false; info.style.display = "none"; }
    else { showInfo = true; info.style.display = "flex"; }
}

function toggleGuide() {
    if (showGuide) { showGuide = false; guide.style.display = "none"; }
    else { showGuide = true; guide.style.display = "flex"; }
}

function changeVolume(d) {
    if (isOn) {
        volumeStepsContainer.style.opacity = 1;
        clearTimeout(volumeFadeoutTimer);
        volume += d;
        if (volume > 0) { player.unMute(); isMuted = false; muteIcon.src = "icons/volume-2.svg"; }
        if (volume >= 100) volume = 100;
        if (volume <= 0) { volume = 0; muteIcon.src = "icons/volume-x.svg"; player.mute(); isMuted = true; }
        localStorage.setItem("storedVolume", volume);
        player.setVolume(volume);
        volumeSteps.innerHTML = "";
        for (let i = 0; i < volume; i += 5) volumeSteps.innerHTML += '<div class="step"></div>';
        volumeFadeoutTimer = setTimeout(() => { volumeStepsContainer.style.opacity = 0; }, 3000);
    }
}

function toggleFullScreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.body.requestFullscreen();
}

document.body.addEventListener("fullscreenchange", function () {
    let fullScreenIcon = document.querySelector(".control .full-screen-icon");
    fullScreenIcon.src = document.fullscreenElement ? "icons/minimize.svg" : "icons/maximize.svg";
});

function numberInput(n) {
    if (isOn) {
        clearTimeout(numberInputTimer);
        clearTimeout(channelNameFadeoutTimer);
        channelNumberInput += n;
        channelName.textContent = channelNumberInput;
        channelName.style.opacity = 1;
        numberInputTimer = setTimeout(() => {
            playChannel(Number(channelNumberInput), true);
            channelNumberInput = "";
        }, 1800);
    }
}

function recallChannel() {
    if (isOn && lastChannelNumber != channelNumber) playChannel(Number(lastChannelNumber), true);
}

function goToChannel() {
    if (isOn) {
        clearTimeout(numberInputTimer);
        clearTimeout(channelNameFadeoutTimer);
        playChannel(Number(channelNumberInput), true);
        channelNumberInput = "";
    }
}
