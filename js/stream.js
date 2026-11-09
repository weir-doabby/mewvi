/** Termitoon cross-platform VLC launcher. Browser/OS confirmation dialogs cannot be suppressed by a website. */
const TermitoonStream = {
  openInVLC(videoUrl, title = '') {
    if (!videoUrl) return;
    let media;
    try {
      media = new URL(String(videoUrl).trim(), window.location.href);
      if (!['http:', 'https:'].includes(media.protocol)) throw new Error('Unsupported media URL');
    } catch (_) {
      this.showToast('لینک پخش معتبر نیست.');
      return;
    }

    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    let target;
    if (isIOS) {
      target = 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(media.href);
    } else if (isAndroid) {
      target = 'intent://' + media.href.replace(/^https?:\/\//i, '') + '#Intent;scheme=' + media.protocol.slice(0, -1) + ';package=org.videolan.vlc;action=android.intent.action.VIEW;type=video/*;end';
    } else {
      // This must be initiated synchronously from the click so Chrome can offer its external-app prompt.
      target = 'vlc://' + media.href;
    }

    const launch = document.createElement('a');
    launch.href = target;
    launch.rel = 'noopener noreferrer';
    launch.style.display = 'none';
    document.body.appendChild(launch);
    try { launch.click(); } catch (error) { console.warn('VLC launch request failed', error); }
    launch.remove();

    // Websites cannot reliably detect whether an external app opened. Only show a clickable install fallback
    // if the browser remains visible; do not show a misleading “stream is transferring” status toast.
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') this.showVlcInstallFallback(isIOS, isAndroid);
    }, 1800);
  },

  showVlcInstallFallback(isIOS, isAndroid) {
    let panel = document.getElementById('vlcInstallFallback');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'vlcInstallFallback';
      panel.style.cssText = 'position:fixed;left:16px;right:16px;bottom:20px;max-width:560px;margin:auto;z-index:1000000;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#17171d;border:1px solid rgba(255,255,255,.16);border-radius:16px;color:#fff;box-shadow:0 12px 36px rgba(0,0,0,.45);direction:rtl;font:13px system-ui,sans-serif;';
      document.body.appendChild(panel);
    }
    const href = isIOS ? 'https://apps.apple.com/app/vlc-media-player/id650377962' : (isAndroid ? 'https://play.google.com/store/apps/details?id=org.videolan.vlc' : 'https://www.videolan.org/vlc/');
    const label = isIOS ? 'App Store' : (isAndroid ? 'Google Play' : 'دانلود VLC برای کامپیوتر');
    panel.replaceChildren();
    const message = document.createElement('span');
    message.textContent = 'اگر VLC باز نشد، برنامه را نصب کنید:';
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = label;
    link.style.cssText = 'color:#ff4b58;font-weight:700;white-space:nowrap;text-decoration:underline;';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','بستن');
    close.style.cssText = 'color:#aaa;font-size:20px;line-height:1;padding:0 4px;';
    close.onclick = () => panel.remove();
    panel.append(message, link, close);
    window.clearTimeout(this._fallbackTimer);
    this._fallbackTimer = window.setTimeout(() => panel?.remove(), 10000);
  },

  downloadStreamFile(videoUrl, title = 'Stream') {
    if (!videoUrl) return;
    const safeTitle = (title || 'Stream').replace(/[\r\n]/g, ' ');
    const m3u = `#EXTM3U\n#EXTINF:-1,${safeTitle}\n${String(videoUrl).trim()}\n`;
    const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = safeTitle.replace(/[/\\?%*:|"<>]/g, '_') + '.m3u';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 1500);
    this.showToast('فایل فهرست پخش دانلود شد.');
  },

  getVlcProtocolUrl(videoUrl) {
    const cleanUrl = (videoUrl || '').trim();
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIOS
      ? 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(cleanUrl)
      : 'vlc://' + cleanUrl;
  },

  showToast(msg) {
    let toast = document.getElementById('appleToast');
    if (!toast) {
      toast = document.createElement('div'); toast.id = 'appleToast';
      toast.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(22,22,28,.95);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.15);color:#fff;padding:11px 24px;border-radius:16px;font-weight:600;font-size:13px;box-shadow:0 16px 36px rgba(0,0,0,.7);z-index:999999;transition:transform .3s,opacity .3s;opacity:0;pointer-events:none;direction:rtl;font-family:Vazirmatn,system-ui,sans-serif;`;
      document.body.appendChild(toast);
    }
    toast.textContent = msg; toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(20px)'; }, 3200);
  }
};
