/**
 * Termitoon Database Layer
 * SQLite-backed authoritative storage using Node.js built-in node:sqlite
 * Includes automatic JSON sync for backward compatibility.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const pageGenerator = require('./pageGenerator.js');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'database.sqlite');
const JSON_BACKUP_PATH = path.join(DATA_DIR, 'series.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize SQLite database
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency & foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables and indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', -- 'admin' or 'user'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip TEXT,
    user_agent TEXT,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    category_type TEXT NOT NULL, -- 'movies', 'series', 'anime', 'animation'
    title_fa TEXT NOT NULL,
    title_en TEXT NOT NULL,
    year TEXT,
    duration TEXT,
    age_rating TEXT,
    rating TEXT,
    country TEXT,
    poster TEXT,
    backdrop TEXT,
    description TEXT,
    video_720 TEXT,
    video_1080 TEXT,
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_saved (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_slug TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, content_slug)
  );

  CREATE INDEX IF NOT EXISTS idx_content_slug ON content(slug);
  CREATE INDEX IF NOT EXISTS idx_content_cat ON content(category_type);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_user_saved_user ON user_saved(user_id);
`);

// ============================================================================
// PASSWORD HASHING (OWASP Recommended Scrypt)
// ============================================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const originalKey = Buffer.from(parts[2], 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  if (originalKey.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(originalKey, derivedKey);
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================
const stmtGetUserByEmail = db.prepare('SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = ? COLLATE NOCASE');
const stmtGetUserById = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?');
const stmtInsertUser = db.prepare('INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
const stmtUpdateUserRole = db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?');
const stmtUpdateUserPassword = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?');

function getUserByEmail(email) {
  return stmtGetUserByEmail.get(email.trim().toLowerCase());
}

function getUserById(id) {
  return stmtGetUserById.get(id);
}

function createUser(name, email, password, role = 'user') {
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);
  const info = stmtInsertUser.run(name.trim(), email.trim().toLowerCase(), passwordHash, role, now, now);
  return {
    id: Number(info.lastInsertRowid),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    role: role
  };
}

function initAdminUser(defaultEmail, defaultPassword) {
  const email = (process.env.ADMIN_EMAIL || defaultEmail || '').trim().toLowerCase();
  const pass = (process.env.ADMIN_PASSWORD || defaultPassword || '').trim();
  // Never create an administrator with a hard-coded/default password.
  if (!email || pass.length < 12) {
    console.warn('[Database] Admin bootstrap skipped. Set ADMIN_EMAIL and a strong ADMIN_PASSWORD in the environment.');
    return;
  }
  const existing = getUserByEmail(email);
  const now = new Date().toISOString();

  if (!existing) {
    const passwordHash = hashPassword(pass);
    stmtInsertUser.run('مدیر کل Termitoon', email, passwordHash, 'admin', now, now);
    console.log(`[Database] Initial admin created: ${email}`);
  } else {
    const passwordHash = hashPassword(pass);
    db.prepare('UPDATE users SET password_hash = ?, role = ?, updated_at = ? WHERE id = ?').run(passwordHash, 'admin', now, existing.id);
    console.log(`[Database] Admin credentials updated: ${email}`);
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================
const stmtInsertSession = db.prepare('INSERT INTO sessions (token, user_id, ip, user_agent, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const stmtGetSession = db.prepare(`
  SELECT s.token, s.user_id, s.expires_at, u.name, u.email, u.role
  FROM sessions s
  JOIN users u ON s.user_id = u.id
  WHERE s.token = ?
`);
const stmtDeleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const stmtDeleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const stmtCleanExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

function createSession(userId, ip = '', userAgent = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
  const now = new Date().toISOString();
  stmtInsertSession.run(token, userId, ip, userAgent, expiresAt, now);
  return { token, expiresAt };
}

function getSession(token) {
  if (!token) return null;
  const session = stmtGetSession.get(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    stmtDeleteSession.run(token);
    return null;
  }
  return {
    token: session.token,
    user: {
      id: session.user_id,
      name: session.name,
      email: session.email,
      role: session.role
    }
  };
}

function deleteSession(token) {
  if (token) stmtDeleteSession.run(token);
}

function cleanExpiredSessions() {
  stmtCleanExpiredSessions.run(Date.now());
}

// ============================================================================
// CONTENT MANAGEMENT & SYNCHRONIZATION
// ============================================================================
const stmtGetAllContent = db.prepare('SELECT raw_json FROM content ORDER BY id DESC');
const stmtGetContentBySlug = db.prepare('SELECT raw_json FROM content WHERE slug = ?');
const stmtCountContent = db.prepare('SELECT COUNT(*) as count FROM content');
const stmtInsertContent = db.prepare(`
  INSERT INTO content (
    slug, category_type, title_fa, title_en, year, duration,
    age_rating, rating, country, poster, backdrop, description,
    video_720, video_1080, raw_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateContent = db.prepare(`
  UPDATE content SET
    category_type = ?, title_fa = ?, title_en = ?, year = ?, duration = ?,
    age_rating = ?, rating = ?, country = ?, poster = ?, backdrop = ?,
    description = ?, video_720 = ?, video_1080 = ?, raw_json = ?, updated_at = ?
  WHERE slug = ?
`);
const stmtDeleteContent = db.prepare('DELETE FROM content WHERE slug = ?');
const stmtDeleteSavedBySlug = db.prepare('DELETE FROM user_saved WHERE content_slug = ?');

function getAllContent() {
  const rows = stmtGetAllContent.all();
  return rows.map(r => {
    try {
      return JSON.parse(r.raw_json);
    } catch(e) {
      return null;
    }
  }).filter(Boolean);
}

function getContentBySlug(slug) {
  const row = stmtGetContentBySlug.get(slug);
  if (!row) return null;
  try {
    return JSON.parse(row.raw_json);
  } catch(e) {
    return null;
  }
}

function getPaginatedContent(page = 1, limit = 20, category = 'all') {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.max(1, parseInt(limit, 10) || 20);
  const offset = (page - 1) * limit;

  let total = 0;
  let rows = [];

  if (category && category !== 'all') {
    const countRow = db.prepare('SELECT COUNT(*) as c FROM content WHERE category_type = ?').get(category);
    total = countRow ? countRow.c : 0;
    rows = db.prepare('SELECT slug, title_fa, title_en, year, rating, category_type, poster, director FROM content WHERE category_type = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(category, limit, offset);
  } else {
    const countRow = db.prepare('SELECT COUNT(*) as c FROM content').get();
    total = countRow ? countRow.c : 0;
    rows = db.prepare('SELECT slug, title_fa, title_en, year, rating, category_type, poster, director FROM content ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  }

  return {
    total,
    page,
    limit,
    category,
    pages: Math.max(1, Math.ceil(total / limit)),
    items: rows
  };
}

function searchAdminContent(q = '') {
  if (!q.trim()) return [];
  const term = `%${q.trim()}%`;
  return db.prepare('SELECT slug, title_fa, title_en, year, rating, category_type, poster, director FROM content WHERE slug LIKE ? OR title_fa LIKE ? OR title_en LIKE ? OR director LIKE ? OR actors LIKE ? OR search_keywords LIKE ? LIMIT 30').all(term, term, term, term, term, term);
}

function searchPublicContent(q = '') {
  if (!q.trim()) return [];
  const term = `%${q.trim()}%`;
  return db.prepare('SELECT slug, title_fa, title_en, year, rating, category_type, poster, backdrop, director, actors, search_keywords FROM content WHERE slug LIKE ? OR title_fa LIKE ? OR title_en LIKE ? OR search_keywords LIKE ? OR director LIKE ? OR actors LIKE ? LIMIT 40').all(term, term, term, term, term, term);
}

function getActorFilmographyWorks(name = '') {
  if (!name.trim()) return [];
  const term = `%${name.trim()}%`;
  return db.prepare('SELECT slug, title_fa, title_en, year, rating, category_type, poster, backdrop, director FROM content WHERE actors LIKE ? OR director LIKE ? LIMIT 50').all(term, term);
}

/**
 * Persists an item to SQLite and syncs JSON backup file atomically
 */
function saveContentItem(item) {
  if (!item || !item.slug) {
    throw new Error('Content item must contain a valid unique slug');
  }

  const now = new Date().toISOString();
  const slug = item.slug.trim();
  const cat = item.category_type || 'movies';
  const titleFa = item.title_fa || item.title_en || 'بدون عنوان';
  const titleEn = item.title_en || '';
  const year = String(item.year || '2024');
  const duration = item.duration || '';
  const ageRating = item.age_rating || 'PG-13';
  const rating = String(item.rating || '8.0');
  const country = item.country || 'آمریکا';
  const poster = item.poster || '';
  const backdrop = item.backdrop || '';
  const description = item.description || '';
  const video720 = item.video_720 || '';
  const video1080 = item.video_1080 || item.video || '';
  const rawJson = JSON.stringify(item);

  const existing = stmtGetContentBySlug.get(slug);

  db.exec('BEGIN TRANSACTION;');
  try {
    if (existing) {
      stmtUpdateContent.run(
        cat, titleFa, titleEn, year, duration,
        ageRating, rating, country, poster, backdrop,
        description, video720, video1080, rawJson, now,
        slug
      );
    } else {
      stmtInsertContent.run(
        slug, cat, titleFa, titleEn, year, duration,
        ageRating, rating, country, poster, backdrop,
        description, video720, video1080, rawJson, now, now
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  // Atomically sync JSON backup
  syncJsonFile();

  // Also write individual detail file
  try {
    const detailsDir = path.join(DATA_DIR, 'details');
    if (!fs.existsSync(detailsDir)) fs.mkdirSync(detailsDir, { recursive: true });
    fs.writeFileSync(path.join(detailsDir, `${slug}.json`), JSON.stringify(item), 'utf8');
  } catch (detErr) {
    console.error('[Database] Warning: could not write details json:', detErr.message);
  }

  // Generate / update dedicated category HTML page on disk
  try {
    pageGenerator.generateContentPage(item);
  } catch (genErr) {
    console.error('[Database] Warning: could not generate static page:', genErr.message);
  }

  return item;
}

function deleteContentItem(slug) {
  const existing = getContentBySlug(slug);

  db.exec('BEGIN TRANSACTION;');
  try {
    stmtDeleteContent.run(slug);
    stmtDeleteSavedBySlug.run(slug);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  syncJsonFile();

  try {
    const detailFile = path.join(DATA_DIR, 'details', `${slug}.json`);
    if (fs.existsSync(detailFile)) fs.unlinkSync(detailFile);
  } catch (e) {}

  // Remove dedicated HTML page and folder from disk
  try {
    pageGenerator.deleteContentPage(slug, existing ? existing.category_type : null);
  } catch (delErr) {
    console.error('[Database] Warning: could not delete static page:', delErr.message);
  }

  return true;
}

function bulkSyncContent(items) {
  if (!Array.isArray(items)) throw new Error('Items must be an array');
  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec('DELETE FROM content;');
    for (const item of items) {
      if (!item || !item.slug) continue;
      const slug = item.slug.trim();
      const cat = item.category_type || 'movies';
      const titleFa = item.title_fa || item.title_en || 'بدون عنوان';
      const titleEn = item.title_en || '';
      const year = String(item.year || '2024');
      const duration = item.duration || '';
      const ageRating = item.age_rating || 'PG-13';
      const rating = String(item.rating || '8.0');
      const country = item.country || 'آمریکا';
      const poster = item.poster || '';
      const backdrop = item.backdrop || '';
      const description = item.description || '';
      const video720 = item.video_720 || '';
      const video1080 = item.video_1080 || item.video || '';
      const rawJson = JSON.stringify(item);

      stmtInsertContent.run(
        slug, cat, titleFa, titleEn, year, duration,
        ageRating, rating, country, poster, backdrop,
        description, video720, video1080, rawJson, now, now
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  syncJsonFile();

  // Synchronize all dedicated static pages on disk
  try {
    pageGenerator.syncAllContentPages(items);
  } catch(syncErr) {
    console.error('[Database] Warning: could not sync all static pages:', syncErr.message);
  }

  return items.length;
}

/**
 * Write current SQLite catalog to data/series.json atomically via temp file
 * Preserves all download links, video URLs, and seasons.
 * Uses synchronous stream-based iteration for constant O(1) memory usage.
 */
function syncJsonFile() {
  const tempFile = JSON_BACKUP_PATH + '.tmp.' + Date.now();
  const rootPath = path.join(ROOT_DIR, 'series.json');
  const rootTemp = rootPath + '.tmp.' + Date.now();

  try {
    const fd = fs.openSync(tempFile, 'w');
    fs.writeSync(fd, '[\n');

    let first = true;
    for (const row of stmtGetAllContent.iterate()) {
      try {
        const item = JSON.parse(row.raw_json);
        const isMovie = item.category_type === 'movies' || item.category_type === 'animation' || (!item.seasons || item.seasons.length === 0);

        const cleanItem = {
          slug: item.slug,
          category_type: item.category_type || 'movies',
          title_fa: item.title_fa || item.title_en || '',
          title_en: item.title_en || '',
          year: item.year || 2024,
          rating: item.rating || '0.0',
          poster: item.poster || '',
          backdrop: item.backdrop || '',
          genres: item.genres || [],
          country: item.country || '',
          duration: item.duration || '',
          age_rating: item.age_rating || '',
          description: (item.description || '').substring(0, 300),
          seasons_count: item.seasons_count || (Array.isArray(item.seasons) ? item.seasons.length : 0),
          total_episodes: item.total_episodes || (Array.isArray(item.seasons) ? item.seasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0) : 0)
        };

        if (isMovie) {
          if (item.download_links && item.download_links.length > 0) cleanItem.download_links = item.download_links;
          if (item.video_720) cleanItem.video_720 = item.video_720;
          if (item.video_1080) cleanItem.video_1080 = item.video_1080;
          if (item.video) cleanItem.video = item.video;
        }

        const line = (first ? '' : ',\n') + JSON.stringify(cleanItem);
        first = false;
        fs.writeSync(fd, line);
      } catch (err) {}
    }

    fs.writeSync(fd, '\n]');
    fs.closeSync(fd);

    fs.renameSync(tempFile, JSON_BACKUP_PATH);
    fs.copyFileSync(JSON_BACKUP_PATH, rootPath);
  } catch (err) {
    console.error('[Database] Failed to sync JSON backup file:', err);
  }
}

/**
 * Initial boot migration: if DB is empty but series.json has content, seed DB.
 */
function checkInitialBootMigration() {
  const countRow = stmtCountContent.get();
  if (countRow.count === 0 && fs.existsSync(JSON_BACKUP_PATH)) {
    try {
      const raw = fs.readFileSync(JSON_BACKUP_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[Database] Boot migration: found ${parsed.length} items in series.json. Importing to SQLite...`);
        bulkSyncContent(parsed);
        console.log('[Database] Boot migration complete.');
      }
    } catch(e) {
      console.warn('[Database] Could not read initial series.json for seeding:', e.message);
    }
  }
}

// ============================================================================
// USER SAVED / BOOKMARKS ENGINE
// ============================================================================
const stmtGetUserSaved = db.prepare('SELECT content_slug FROM user_saved WHERE user_id = ? ORDER BY id DESC');
const stmtCheckUserSaved = db.prepare('SELECT id FROM user_saved WHERE user_id = ? AND content_slug = ?');
const stmtInsertUserSaved = db.prepare('INSERT OR IGNORE INTO user_saved (user_id, content_slug, created_at) VALUES (?, ?, ?)');
const stmtDeleteUserSaved = db.prepare('DELETE FROM user_saved WHERE user_id = ? AND content_slug = ?');

function getUserSavedSlugs(userId) {
  const rows = stmtGetUserSaved.all(userId);
  return rows.map(r => r.content_slug);
}

function toggleUserSaved(userId, slug) {
  const existing = stmtCheckUserSaved.get(userId, slug);
  const now = new Date().toISOString();
  if (existing) {
    stmtDeleteUserSaved.run(userId, slug);
    return { saved: false, slug };
  } else {
    stmtInsertUserSaved.run(userId, slug, now);
    return { saved: true, slug };
  }
}

function mergeUserSaved(userId, slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return getUserSavedSlugs(userId);
  }
  const now = new Date().toISOString();
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const s of slugs) {
      if (typeof s === 'string' && s.trim()) {
        stmtInsertUserSaved.run(userId, s.trim(), now);
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return getUserSavedSlugs(userId);
}

// Run boot operations
checkInitialBootMigration();
initAdminUser();

// Export database operations
module.exports = {
  db,
  hashPassword,
  verifyPassword,
  getUserByEmail,
  getUserById,
  createUser,
  initAdminUser,
  createSession,
  getSession,
  deleteSession,
  cleanExpiredSessions,
  getAllContent,
  getPaginatedContent,
  searchAdminContent,
  searchPublicContent,
  getActorFilmographyWorks,
  getContentBySlug,
  saveContentItem,
  deleteContentItem,
  bulkSyncContent,
  getUserSavedSlugs,
  toggleUserSaved,
  mergeUserSaved
};
