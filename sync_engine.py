#!/usr/bin/env python3
"""
Mewvi Sync & Deployment Engine
Integrates:
1. Simba API (Movies & Series)
2. AniPlus (Newest Anime from https://app.variko.org/)
3. Cloudflare Package Rebuilder
4. Automated Wrangler Deployment
"""

import os, sys, json, sqlite3, re, subprocess
from datetime import datetime

BASE_DIR = '/Users/lhotse/Desktop/Mewvi-Clean-UltraLight'
CLOUDFLARE_DIR = '/Users/lhotse/Desktop/Mewvi-Cloudflare'
DB_PATH = os.path.join(BASE_DIR, 'data', 'database.sqlite')

SECURE_KEY = '4F5A9C3D9A86FA54EACEDDD635185'
SIMBA_RESOLVER = 'http://ninnies-server.info/api-user/newapi/config-server186.txt'
DEFAULT_SIMBA_DOMAIN = 'http://ninwinios.info/api/'

def curl_get(url, timeout=12):
    try:
        res = subprocess.run(
            ['curl', '-sL', '-k', '-m', str(timeout), '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', url],
            capture_output=True,
            text=True
        )
        return res.stdout
    except Exception as e:
        print(f"[cURL] Error fetching {url}: {e}")
        return ""

def get_simba_domain():
    text = curl_get(SIMBA_RESOLVER, timeout=5)
    if text and text.strip().startswith('http'):
        return text.strip().rstrip('/') + '/'
    return DEFAULT_SIMBA_DOMAIN

def fetch_json(url, timeout=10):
    text = curl_get(url, timeout=timeout)
    if text:
        try: return json.loads(text)
        except: pass
    return []

def sync_simba(limit=20):
    print(f"[Simba] Fetching newest records (limit {limit})...")
    domain = get_simba_domain()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    
    # Fetch newest series
    try:
        series_url = f"{domain}serie/by/filtres/0/created/0/{SECURE_KEY}/"
        series_list = fetch_json(series_url, timeout=10)
        print(f"[Simba] Found {len(series_list)} series from API.")
        s_added = 0
        for s in series_list[:limit]:
            title_fa = str(s.get('title') or '')
            slug = re.sub(r'[^a-zA-Z0-9]+', '-', s.get('slug') or title_fa).strip('-').lower()
            if not slug: slug = f"series-simba-{s.get('id', 0)}"
            
            cur.execute('SELECT id FROM content WHERE slug = ?', (slug,))
            if not cur.fetchone():
                # fetch seasons
                seasons = []
                try:
                    s_id = s.get('id')
                    if s_id:
                        seasons = fetch_json(f"{domain}season/by/serie/{s_id}/{SECURE_KEY}/", timeout=8)
                except: pass
                
                raw = dict(s)
                if seasons: raw['seasons'] = seasons
                
                country = s.get('country')
                if isinstance(country, list):
                    country = ' , '.join([c.get('title', '') if isinstance(c, dict) else str(c) for c in country if c])
                else:
                    country = str(country or '')
                
                cur.execute('''
                    INSERT INTO content (slug, category_type, title_fa, title_en, year, rating, country, poster, backdrop, description, raw_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    slug,
                    'series',
                    title_fa,
                    str(s.get('original_title') or title_fa),
                    str(s.get('year') or ''),
                    str(s.get('rating') or '7.0'),
                    country,
                    str(s.get('poster') or ''),
                    str(s.get('cover') or ''),
                    str(s.get('description') or ''),
                    json.dumps(raw, ensure_ascii=False),
                    now_str,
                    now_str
                ))
                s_added += 1
                print(f"[Simba] Added series: {title_fa} ({slug})")
        print(f"[Simba] Synced {s_added} new series.")
    except Exception as e:
        print(f"[Simba] Series sync warning: {e}")

    conn.commit()
    conn.close()

def sync_aniplus():
    print("[AniPlus] Checking newest anime from https://app.variko.org/ ...")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    
    try:
        sitemap_xml = curl_get('https://app.variko.org/sitemap/anime/sitemap-1.xml', timeout=10)
        paths = re.findall(r'<loc>https?://[^/]+/anime/(\d+/[^<]+)</loc>', sitemap_xml)
        print(f"[AniPlus] Found {len(paths)} anime entries in sitemap-1.")
        
        added_count = 0
        for path in paths[:20]:
            slug_match = re.search(r'\d+/([^/]+)', path)
            if not slug_match: continue
            slug = f"anime-{slug_match.group(1)}"
            
            cur.execute('SELECT id FROM content WHERE slug = ?', (slug,))
            if cur.fetchone():
                continue # Already in catalog
                
            anime_url = f"https://app.variko.org/anime/{path}"
            html = curl_get(anime_url, timeout=8)
            if not html: continue
            
            title_fa = 'انیمه'
            title_m = re.search(r'<title>دانلود انیمه\s*([^<-]+)', html)
            if title_m:
                title_fa = title_m.group(1).strip()
            
            title_en = slug_match.group(1).replace('-', ' ').title()
            
            poster = ''
            img_m = re.search(r'og:image\" content=\"([^\"]+)\"', html)
            if img_m:
                poster = img_m.group(1)
                
            desc = ''
            desc_m = re.search(r'og:description\" content=\"([^\"]+)\"', html)
            if desc_m:
                desc = desc_m.group(1)
                
            rating = '8.0'
            rate_m = re.search(r'ratingValue\":\s*([\d\.]+)', html)
            if rate_m:
                rating = str(rate_m.group(1))
                
            # Extract download tabs and episode counts
            seasons = []
            episodes = []
            tabs = re.findall(r'<download-tab[^>]*>(.*?)</download-tab>', html, re.DOTALL)
            ep_dict = {}
            for tab in tabs:
                q_match = re.search(r'item-quality">([^<]+)<', tab)
                q = q_match.group(1).strip() if q_match else '720p'
                links_m = re.search(r":links='([^']+)'", tab)
                if links_m:
                    try:
                        t_data = json.loads(unescape(links_m.group(1)))
                        for ep_item in t_data.get('data', []):
                            ep_num = ep_item.get('es', 1)
                            if ep_num not in ep_dict:
                                ep_dict[ep_num] = {
                                    'episode_number': ep_num,
                                    'title': f"قسمت {ep_num}",
                                    'download_links': []
                                }
                            if ep_item.get('link') and ep_item['link'] != '#':
                                ep_dict[ep_num]['download_links'].append({
                                    'quality': q,
                                    'url': ep_item['link']
                                })
                    except: pass
            
            if ep_dict:
                for ep_num in sorted(ep_dict.keys()):
                    episodes.append(ep_dict[ep_num])
            else:
                # Fallback episodes
                episodes = [{'episode_number': i, 'title': f'قسمت {i}', 'download_links': [{'quality': '720p', 'url': anime_url}]} for i in range(1, 13)]
                
            seasons = [{
                'season_number': 1,
                'title': 'فصل 1',
                'episodes': episodes
            }]
            
            raw_data = {
                'slug': slug,
                'title_fa': title_fa,
                'title_en': title_en,
                'poster': poster,
                'description': desc,
                'rating': rating,
                'category_type': 'anime',
                'source_url': anime_url,
                'source': 'aniplus',
                'seasons': seasons,
                'seasons_count': 1
            }
            
            cur.execute('''
                INSERT INTO content (slug, category_type, title_fa, title_en, year, rating, poster, backdrop, description, raw_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                slug,
                'anime',
                title_fa,
                title_en,
                '2026',
                rating,
                poster,
                poster,
                desc,
                json.dumps(raw_data, ensure_ascii=False),
                now_str,
                now_str
            ))
            added_count += 1
            print(f"[AniPlus] Added new anime: {title_fa} ({slug}) with {len(episodes)} episodes")
            
        print(f"[AniPlus] Successfully synced {added_count} new anime titles.")
    except Exception as e:
        print(f"[AniPlus] Sync error: {e}")

    conn.commit()
    conn.close()

def rebuild_cloudflare():
    print("[MUV] Regenerating 46-row homepage showcase...")
    subprocess.run([sys.executable, os.path.join(BASE_DIR, 'muv_engine.py')], check=True)
    print("[Build] Rebuilding Cloudflare shards and distribution package...")
    cmd = [sys.executable, os.path.join(BASE_DIR, 'build_cloudflare_package.py')]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(res.stdout)
    if res.returncode != 0:
        print(f"[Build] Error: {res.stderr}")
    git_push_update()

def git_push_update():
    print('[Git] Committing and pushing updates to GitHub...')
    try:
        subprocess.run(['git', '-C', CLOUDFLARE_DIR, 'config', 'http.version', 'HTTP/1.1'], check=True)
        status = subprocess.run(['git', '-C', CLOUDFLARE_DIR, 'status', '--porcelain'], capture_output=True, text=True)
        if not status.stdout.strip():
            print('[Git] No changes to commit. Everything is up to date.')
            return
        subprocess.run(['git', '-C', CLOUDFLARE_DIR, 'add', '.'], check=True)
        msg = f'Daily Auto-Sync: {datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")}'
        subprocess.run(['git', '-C', CLOUDFLARE_DIR, 'commit', '-m', msg], check=True)
        subprocess.run(['git', '-C', CLOUDFLARE_DIR, 'push', 'origin', 'main'], check=True)
        print('[Git] Successfully pushed updates to GitHub!')
    except Exception as e:
        print(f'[Git] Push notice: {e}')

def deploy_cloudflare():
    print("[Deploy] Deploying to Cloudflare Pages via Wrangler...")
    cmd = ['npx', '--yes', 'wrangler', 'pages', 'deploy', CLOUDFLARE_DIR, '--project-name', 'mewvi']
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(res.stdout)
    if res.stderr:
        print(res.stderr)

if __name__ == '__main__':
    print("=== Mewvi Sync Engine Started ===")
    sync_simba(limit=25)
    sync_aniplus()
    rebuild_cloudflare()
    
    if '--deploy' in sys.argv:
        deploy_cloudflare()
    print("=== Sync Complete ===")
