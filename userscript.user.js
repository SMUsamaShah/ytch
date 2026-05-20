// ==UserScript==
// @name         YTCH – Add to TV
// @namespace    https://github.com/SMUsamaShah/ytch
// @version      2.0
// @description  Add YouTube videos to your YTCH pool with channel picker
// @author       SMUsamaShah
// @match        https://www.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      gist.githubusercontent.com
// ==/UserScript==

(function () {
    'use strict';

    // ── Config (set once via the Tampermonkey menu) ───────────────────────────
    const CHANNELS = [
        [1,"Science & Technology"],[2,"Travel & Events"],[3,"Food"],
        [4,"Architecture"],[5,"Film & Animation"],[6,"Documentaries"],
        [7,"Comedy"],[8,"Music"],[9,"Autos & Vehicles"],[10,"News"],
        [11,"UFC"],[12,"Podcasts"],[13,"Gaming"],[14,"Literature"],
        [15,"Cooking"],[16,"Short Films"],[17,"Game Shows"],[18,"Cartoons"],[19,"Baseball"]
    ];

    GM_registerMenuCommand("Set GitHub PAT", () => {
        const val = prompt("GitHub Personal Access Token (ghp_...)", GM_getValue("pat", ""));
        if (val !== null) GM_setValue("pat", val.trim());
    });
    GM_registerMenuCommand("Set Gist ID", () => {
        const val = prompt("Gist ID for pool.json", GM_getValue("gist", ""));
        if (val !== null) GM_setValue("gist", val.trim());
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    function extractDurationFromPage() {
        // Try the duration badge on the video player
        const badge = document.querySelector(".ytp-time-duration");
        if (badge) return parseDuration(badge.textContent.trim());
        // Try rich shelf / thumbnail overlays
        const overlay = document.querySelector("ytd-thumbnail-overlay-time-status-renderer .badge-shape-wiz__text");
        if (overlay) return parseDuration(overlay.textContent.trim());
        return null;
    }

    function parseDuration(str) {
        // "4:35" or "1:04:35"
        const parts = str.split(":").map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return null;
    }

    function extractVideoId() {
        const p = new URLSearchParams(location.search);
        return p.get("v");
    }

    function fmtDuration(s) {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
        return `${m}:${String(sec).padStart(2,"0")}`;
    }

    function showToast(msg, color = "#333") {
        let t = document.getElementById("ytch-toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "ytch-toast";
            Object.assign(t.style, {
                position: "fixed", bottom: "80px", right: "20px",
                padding: "10px 16px", borderRadius: "8px", color: "#fff",
                fontSize: "14px", zIndex: "9999", opacity: "0",
                transition: "opacity 0.3s", pointerEvents: "none"
            });
            document.body.appendChild(t);
        }
        t.style.background = color;
        t.textContent = msg;
        t.style.opacity = "1";
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = "0"; }, 3000);
    }

    // ── Gist helpers ──────────────────────────────────────────────────────────
    function gistRequest(method, path, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: `https://api.github.com${path}`,
                headers: {
                    "Authorization": `token ${GM_getValue("pat", "")}`,
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.github.v3+json"
                },
                data: body ? JSON.stringify(body) : undefined,
                onload: r => {
                    if (r.status >= 200 && r.status < 300) resolve(JSON.parse(r.responseText));
                    else reject(new Error(`HTTP ${r.status}`));
                },
                onerror: reject
            });
        });
    }

    async function addToPool(video, ch) {
        const gistId = GM_getValue("gist", "");
        if (!GM_getValue("pat", "") || !gistId) {
            showToast("Set GitHub PAT and Gist ID in Tampermonkey menu", "#c00");
            return;
        }
        const gistData = await gistRequest("GET", `/gists/${gistId}`);
        const poolFile = gistData.files["pool.json"];
        let pool = poolFile ? JSON.parse(poolFile.content) : {};

        if (!pool[ch]) pool[ch] = { slots: [{ name: "all", start: "00:00", end: "23:59", minDuration: null, maxDuration: null }], pool: [] };
        if (!pool[ch].pool.some(v => v.id === video.id)) pool[ch].pool.push(video);

        await gistRequest("PATCH", `/gists/${gistId}`, {
            files: { "pool.json": { content: JSON.stringify(pool, null, 2) } }
        });
        const chName = CHANNELS.find(c => c[0] === Number(ch))?.[1] || `CH ${ch}`;
        showToast(`✓ Added to CH ${ch} — ${chName}`, "#1a7a1a");
    }

    // ── UI injection ──────────────────────────────────────────────────────────
    function injectButton() {
        if (location.pathname !== "/watch") return;
        if (document.getElementById("ytch-add-btn")) return;

        const videoId = extractVideoId();
        if (!videoId) return;

        const container = document.createElement("div");
        container.id = "ytch-add-btn";
        Object.assign(container.style, {
            display: "inline-flex", alignItems: "center", gap: "6px",
            marginLeft: "8px", verticalAlign: "middle"
        });

        const select = document.createElement("select");
        Object.assign(select.style, {
            background: "#272727", color: "#fff", border: "1px solid #555",
            borderRadius: "18px", padding: "6px 10px", fontSize: "13px", cursor: "pointer"
        });
        CHANNELS.forEach(([n, name]) => {
            const opt = document.createElement("option");
            opt.value = n;
            opt.textContent = `CH ${n} – ${name}`;
            select.appendChild(opt);
        });
        const lastCh = GM_getValue("lastCh", "1");
        select.value = lastCh;

        const btn = document.createElement("button");
        btn.textContent = "📺 Add to TV";
        Object.assign(btn.style, {
            background: "#ff4444", color: "#fff", border: "none",
            borderRadius: "18px", padding: "6px 14px", fontSize: "13px",
            cursor: "pointer", fontWeight: "600"
        });

        btn.addEventListener("click", async () => {
            const ch = Number(select.value);
            GM_setValue("lastCh", String(ch));

            const title = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim()
                || document.title.replace(" - YouTube", "");
            const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            const duration = extractDurationFromPage();

            btn.textContent = "Adding…";
            btn.disabled = true;
            try {
                await addToPool({ id: videoId, title, thumbnail, duration }, ch);
            } catch (err) {
                showToast("Error: " + err.message, "#c00");
            }
            btn.textContent = "📺 Add to TV";
            btn.disabled = false;
        });

        container.appendChild(select);
        container.appendChild(btn);

        // Try to mount next to the like/dislike buttons
        const mountInterval = setInterval(() => {
            const actions = document.querySelector("#top-level-buttons-computed, ytd-menu-renderer.ytd-watch-metadata");
            if (actions && !document.getElementById("ytch-add-btn")) {
                actions.appendChild(container);
                clearInterval(mountInterval);
            }
        }, 500);
    }

    // Re-inject on SPA navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(injectButton, 1500);
        }
    }).observe(document.body, { childList: true, subtree: true });

    setTimeout(injectButton, 1500);
})();
