/**
 * MEWVI Centralized Media Resource Routing & Deep Linking System
 * Mobile-First architecture for iOS and Android
 * Interface: resolveMediaResource(content, action, platform)
 */

(function(global) {
  'use strict';

  // =========================================================================
  // 1. DIAGNOSTIC LAYER
  // =========================================================================
  const diagnosticsLogs = [];
  const MAX_LOGS = 100;

  function recordDiagnostic(entry) {
    const record = {
      timestamp: new Date().toISOString(),
      contentId: entry.contentId || 'unknown',
      episodeId: entry.episodeId || null,
      title: entry.title || 'Untitled',
      action: entry.action || 'unknown',
      platform: entry.platform || 'unknown',
      resolvedUrl: entry.resolvedUrl ? sanitizeUrlForLog(entry.resolvedUrl) : null,
      quality: entry.quality || 'Auto',
      format: entry.format || 'unknown',
      handoffMethod: entry.handoffMethod || 'unknown',
      status: entry.status || 'UNKNOWN',
      fallbackResult: entry.fallbackResult || null
    };

    diagnosticsLogs.push(record);
    if (diagnosticsLogs.length > MAX_LOGS) {
      diagnosticsLogs.shift();
    }
    return record;
  }

  function sanitizeUrlForLog(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch (_) {
      return String(url).split('?')[0];
    }
  }

  global.__mewviDiagnostics = {
    getLogs: () => [...diagnosticsLogs],
    getLastAction: () => diagnosticsLogs[diagnosticsLogs.length - 1] || null,
    clearLogs: () => { diagnosticsLogs.length = 0; }
  };

  // =========================================================================
  // 2. PLATFORM DETECTION (MOBILE-FIRST)
  // =========================================================================
  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const maxTouchPoints = navigator.maxTouchPoints || 0;

    // iOS Detection (iPhone, iPad, iPod, including iPadOS with desktop Safari UA)
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
    if (isIOS) return 'ios';

    // Android Detection
    if (/Android/i.test(ua)) return 'android';

    // Desktop fallback
    return 'desktop';
  }

  // =========================================================================
  // 3. URL NORMALIZATION & FORMAT IDENTIFICATION
  // =========================================================================
  function normalizeMediaUrl(url) {
    if (!url) return '';
    let u = String(url).trim();
    // Upgrade http to https when possible, preserving query strings
    if (u.startsWith('http://ninwinios.info')) {
      u = 'https://ninwinios.info' + u.slice(20);
    }
    return u;
  }

  function identifyMediaFormat(url) {
    if (!url) return 'unknown';
    const clean = String(url).toLowerCase().split('?')[0];
    if (clean.endsWith('.m3u8')) return 'hls';
    if (clean.endsWith('.mp4')) return 'mp4';
    if (clean.endsWith('.mkv')) return 'mkv';
    if (clean.endsWith('.webm')) return 'webm';
    return 'mp4';
  }

  // =========================================================================
  // 4. RESOURCE EXTRACTION & RESOLUTION
  // =========================================================================
  function extractAllResources(content) {
    if (!content) return [];
    const resources = [];
    const seen = new Set();

    const addResource = (url, quality, type = 'stream_download', audio = '') => {
      const norm = normalizeMediaUrl(url);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      const fmt = identifyMediaFormat(norm);
      resources.push({
        url: norm,
        quality: quality || '720p HD',
        format: fmt,
        type: fmt === 'hls' ? 'stream_only' : type,
        audio: audio || (quality && quality.includes('دوبله') ? 'دوبله فارسی' : 'زیرنویس')
      });
    };

    // If direct variant passed
    if (content.variant && content.variant.url) {
      addResource(content.variant.url, content.variant.quality || content.variant.label);
    }
    if (content.url) {
      addResource(content.url, content.quality);
    }

    // Episode resources
    const ep = content.episode;
    if (ep) {
      if (ep.video_1080) addResource(ep.video_1080, '1080p Full HD');
      if (ep.video_720) addResource(ep.video_720, '720p HD');
      if (ep.video_480) addResource(ep.video_480, '480p');
      if (ep.video) addResource(ep.video, '720p HD');
      if (Array.isArray(ep.download_links)) {
        ep.download_links.forEach(dl => {
          if (dl && dl.url) addResource(dl.url, dl.quality, 'download');
        });
      }
    }

    // Item/Movie resources
    const item = content.item || content;
    if (item) {
      if (item.video_1080) addResource(item.video_1080, '1080p Full HD');
      if (item.video_720) addResource(item.video_720, '720p HD');
      if (item.video) addResource(item.video, '720p HD');
      if (Array.isArray(item.download_links)) {
        item.download_links.forEach(dl => {
          if (dl && dl.url) addResource(dl.url, dl.quality, 'download');
        });
      }
    }

    return resources;
  }

  // =========================================================================
  // 5. CENTRAL RESOURCE ROUTER: resolveMediaResource(content, action, platform)
  // =========================================================================
  function resolveMediaResource(content, action = 'play', requestedPlatform = null) {
    const platform = requestedPlatform || detectPlatform();
    const all = extractAllResources(content);

    const titleFa = content.title_fa || content.item?.title_fa || content.title_en || 'video';
    const titleEn = content.title_en || content.item?.title_en || 'video';
    const safeTitle = (titleFa || titleEn).replace(/[\\/:*?"<>|]/g, '-');
    const contentId = content.slug || content.item?.slug || 'unknown';
    const episodeNum = content.episode?.number || content.episode?.episode_number || null;

    if (all.length === 0) {
      recordDiagnostic({
        contentId,
        episodeId: episodeNum,
        title: safeTitle,
        action,
        platform,
        status: 'FAILED_NO_RESOURCE'
      });
      showAppleToast('لینکی برای این عنوان یافت نشد.');
      return {
        success: false,
        error: 'NO_RESOURCE_FOUND',
        message: 'لینکی برای این عنوان یافت نشد.'
      };
    }

    // Select target resource:
    // If action is download, prefer MP4/MKV download links. If play, prefer video_720/1080 or HLS.
    let selected = null;
    if (content.preferredQuality) {
      selected = all.find(r => r.quality && r.quality.includes(content.preferredQuality));
    }
    if (!selected) {
      if (action === 'download') {
        selected = all.find(r => r.format !== 'hls') || all[0];
      } else {
        selected = all[0];
      }
    }

    const mediaUrl = selected.url;
    const format = selected.format;
    const quality = selected.quality;

    let handoffMethod = '';
    let fallbackResult = null;

    // -----------------------------------------------------------------------
    // ACTION: PLAY (VLC PLAYBACK WITH ZERO-ASYNC USER GESTURE PRESERVATION)
    // -----------------------------------------------------------------------
    if (action === 'play') {
      if (platform === 'ios') {
        // iOS VLC Scheme: vlc-x-callback://x-callback-url/stream?url=ENCODED
        handoffMethod = 'ios_vlc_scheme';
        const vlcUrl = 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(mediaUrl);

        // Copy URL to clipboard immediately as silent fallback
        copyToClipboardSilently(mediaUrl);

        // Synchronous anchor click to preserve user gesture
        triggerExternalHandoff(vlcUrl);
        showAppleToast('در حال انتقال به VLC Media Player...');

        // Fallback UI if VLC is not installed
        showPlaybackFallbackBanner(mediaUrl, safeTitle, 'ios');
        fallbackResult = 'ios_fallback_ready';

      } else if (platform === 'android') {
        // Android Intent for VLC
        handoffMethod = 'android_vlc_intent';
        const cleanUrl = mediaUrl.replace(/^https?:\/\//i, '');
        const scheme = mediaUrl.startsWith('https://') ? 'https' : 'http';

        // Android package intent for VLC
        const vlcIntent = `intent://${cleanUrl}#Intent;action=android.intent.action.VIEW;type=video/*;scheme=${scheme};package=org.videolan.vlc;end`;

        // Copy URL to clipboard
        copyToClipboardSilently(mediaUrl);

        // Synchronous trigger
        triggerExternalHandoff(vlcIntent);
        showAppleToast('در حال انتقال به VLC Media Player...');

        // Fallback UI if VLC is not installed
        showPlaybackFallbackBanner(mediaUrl, safeTitle, 'android');
        fallbackResult = 'android_fallback_ready';

      } else {
        // Desktop / Laptop: direct Web Player launch
        handoffMethod = 'desktop_web_player';
        if (typeof global.openPlayerModal === 'function') {
          global.openPlayerModal(mediaUrl, safeTitle);
        } else {
          window.open(mediaUrl, '_blank');
        }
        fallbackResult = 'web_player_active';
      }

    // -----------------------------------------------------------------------
    // ACTION: DOWNLOAD (PLATFORM-SPECIFIC DOWNLOAD MANAGERS + DIRECT FALLBACK)
    // -----------------------------------------------------------------------
    } else if (action === 'download') {
      const ext = format === 'mkv' ? '.mkv' : '.mp4';
      const cleanFilename = `${safeTitle}-${quality}${ext}`.replace(/[\s\/\:\*\?"\<\>\|]/g, '-');

      if (platform === 'ios') {
        // Documents by Readdle scheme: rhttps:// or rhttp://
        handoffMethod = 'ios_documents_scheme';
        const docSchemeUrl = mediaUrl.startsWith('https://')
          ? 'rhttps://' + mediaUrl.slice(8)
          : 'rhttp://' + mediaUrl.slice(7);

        copyToClipboardSilently(mediaUrl);
        triggerExternalHandoff(docSchemeUrl);
        showAppleToast('لینک کپی شد و به اپلیکیشن Documents ارسال شد.');

        // Direct Safari browser download fallback
        setTimeout(() => {
          triggerBrowserDownload(mediaUrl, cleanFilename);
        }, 1200);
        fallbackResult = 'safari_direct_download';

      } else if (platform === 'android') {
        // Android 1DM / ADM Intent
        handoffMethod = 'android_1dm_intent';
        const cleanUrl = mediaUrl.replace(/^https?:\/\//i, '');
        const scheme = mediaUrl.startsWith('https://') ? 'https' : 'http';
        const intent1dm = `intent://${cleanUrl}#Intent;action=android.intent.action.VIEW;type=video/*;scheme=${scheme};package=idm.internet.download.manager;end`;

        copyToClipboardSilently(mediaUrl);
        triggerExternalHandoff(intent1dm);
        showAppleToast('لینک کپی شد و به 1DM ارسال شد.');

        // Direct Chrome browser download fallback
        setTimeout(() => {
          triggerBrowserDownload(mediaUrl, cleanFilename);
        }, 1200);
        fallbackResult = 'android_direct_download';

      } else {
        // Desktop IDM / Browser download
        handoffMethod = 'desktop_direct_download';
        copyToClipboardSilently(mediaUrl);
        triggerBrowserDownload(mediaUrl, cleanFilename);
        showAppleToast('لینک مستقیم برای IDM کپی و دانلود آغاز شد.');
        fallbackResult = 'desktop_download_triggered';
      }
    }

    recordDiagnostic({
      contentId,
      episodeId: episodeNum,
      title: safeTitle,
      action,
      platform,
      resolvedUrl: mediaUrl,
      quality,
      format,
      handoffMethod,
      status: 'SUCCESS',
      fallbackResult
    });

    return {
      success: true,
      resolvedUrl: mediaUrl,
      quality,
      format,
      handoffMethod,
      fallbackResult
    };
  }

  // =========================================================================
  // 6. HELPER HANDOFF EXECUTORS (SYNCHRONOUS USER GESTURE SAFE)
  // =========================================================================
  function triggerExternalHandoff(targetUrl) {
    if (!targetUrl) return;
    try {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); }, 1000);
    } catch (_) {}

    try {
      window.location.href = targetUrl;
    } catch (_) {}
  }

  function triggerBrowserDownload(url, filename) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'video.mp4';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } catch (e) {
      window.open(url, '_blank');
    }
    setTimeout(() => { a.remove(); }, 500);
  }

  function copyToClipboardSilently(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch (_) {}
      textarea.remove();
    }
  }

  // =========================================================================
  // 7. SLEEK FALLBACK UI FOR PLAYBACK & STORE LINKS
  // =========================================================================
  function showPlaybackFallbackBanner(mediaUrl, title, platform) {
    setTimeout(() => {
      if (document.visibilityState !== 'visible') return;

      let banner = document.getElementById('playbackFallbackBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'playbackFallbackBanner';
        banner.style.cssText = `
          position: fixed;
          bottom: 24px;
          left: 16px;
          right: 16px;
          max-width: 480px;
          margin: 0 auto;
          background: rgba(18, 18, 26, 0.96);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 20px;
          padding: 16px;
          color: #fff;
          z-index: 1000000;
          direction: rtl;
          font-family: Vazirmatn, system-ui, sans-serif;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
          animation: slideUp 0.3s ease;
        `;
        document.body.appendChild(banner);
      }

      const storeLink = platform === 'ios'
        ? 'https://apps.apple.com/app/vlc-media-player/id650377962'
        : 'https://play.google.com/store/apps/details?id=org.videolan.vlc';
      const storeLabel = platform === 'ios' ? 'نصب VLC از App Store' : 'نصب VLC از Google Play';

      banner.innerHTML = `
        <div class="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span class="text-xs font-bold text-gray-200">اگر پخش در VLC شروع نشد:</span>
          </div>
          <button type="button" onclick="this.closest('#playbackFallbackBanner').remove()" class="text-gray-400 hover:text-white text-base leading-none px-1">✕</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button id="btnFallbackWebPlayer" type="button" class="w-full py-2.5 px-3 rounded-xl bg-brandRed hover:bg-brandRedHover active:scale-98 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1">
            <span>پخش در مرورگر (وب‌پلیر)</span>
          </button>
          <a href="${storeLink}" target="_blank" rel="noopener noreferrer" class="w-full py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 active:scale-98 text-white text-xs font-bold transition flex items-center justify-center text-center">
            <span>${storeLabel}</span>
          </a>
        </div>
        <div class="mt-2 text-center">
          <button id="btnFallbackCopyUrl" type="button" class="text-[11px] text-gray-400 hover:text-gray-200 underline">
            کپی مجدد آدرس استریم مستقیم
          </button>
        </div>
      `;

      const btnWeb = banner.querySelector('#btnFallbackWebPlayer');
      if (btnWeb) {
        btnWeb.onclick = () => {
          banner.remove();
          if (typeof global.openPlayerModal === 'function') {
            global.openPlayerModal(mediaUrl, title);
          } else {
            window.open(mediaUrl, '_blank');
          }
        };
      }

      const btnCopy = banner.querySelector('#btnFallbackCopyUrl');
      if (btnCopy) {
        btnCopy.onclick = () => {
          copyToClipboardSilently(mediaUrl);
          showAppleToast('آدرس استریم مستقیم کپی شد.');
        };
      }

      setTimeout(() => {
        if (banner && banner.parentNode) {
          banner.remove();
        }
      }, 12000);
    }, 1500);
  }

  function showAppleToast(msg) {
    let toast = document.getElementById('appleToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appleToast';
      toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(22, 22, 28, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #fff;
        padding: 11px 24px;
        border-radius: 16px;
        font-weight: 600;
        font-size: 13px;
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7);
        z-index: 9999999;
        transition: transform 0.3s, opacity 0.3s;
        opacity: 0;
        pointer-events: none;
        direction: rtl;
        font-family: Vazirmatn, system-ui, sans-serif;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3200);
  }

  // =========================================================================
  // 8. BACKWARD COMPATIBLE TermitoonStream ADAPTER
  // =========================================================================
  const TermitoonStream = {
    openInVLC(videoUrl, title = '') {
      return resolveMediaResource({ url: videoUrl, title_fa: title }, 'play');
    },
    downloadStreamFile(videoUrl, title = 'Stream') {
      return resolveMediaResource({ url: videoUrl, title_fa: title }, 'download');
    },
    showToast(msg) {
      showAppleToast(msg);
    }
  };

  // Expose globally
  global.resolveMediaResource = resolveMediaResource;
  global.MewviMediaRouter = {
    resolve: resolveMediaResource,
    detectPlatform,
    extractAllResources,
    normalizeMediaUrl,
    identifyMediaFormat
  };
  global.TermitoonStream = TermitoonStream;

})(typeof window !== 'undefined' ? window : this);
