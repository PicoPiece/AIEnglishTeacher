const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8005;

// --- Database pool ---
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'parent_reader',
  password: process.env.DB_PASS || 'parent_readonly_pass',
  database: process.env.DB_NAME || 'xiaozhi_esp32_server',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
});

// --- Middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// --- Music file upload ---
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, 'data', 'music');
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120) || 'untitled';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MUSIC_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp3';
      const baseName = req.body.title
        ? sanitizeFilename(req.body.title)
        : sanitizeFilename(path.basename(file.originalname, ext));
      const stamp = Date.now().toString(36);
      const finalName = `${baseName}_${stamp}${ext}`;
      cb(null, finalName);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.m4a'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

// --- Prompt builder helpers ---

const CONFIG_PREFIX = '<!-- PARENT_CONFIG:';
const CONFIG_SUFFIX = '-->';

const DEFAULT_CORE_INSTRUCTIONS = `Speak clearly and simply. Use short sentences.
If the child makes a grammar mistake, gently correct them and explain why.
Encourage the child with positive feedback.
Mix Vietnamese explanations when the child seems confused.
Keep conversations fun and engaging.`;

function buildPromptFromFields(fields) {
  const { childName, age, level, topics, extraNotes } = fields;
  const configJson = JSON.stringify({ childName, age, level, topics, extraNotes });
  const lines = [];
  lines.push(`${CONFIG_PREFIX} ${configJson} ${CONFIG_SUFFIX}`);
  lines.push(`You are Teacher AI, a fun, patient English tutor for ${childName || 'the student'}${age ? ` (${age} years old)` : ''}.`);
  if (level) lines.push(`English level: ${level}.`);
  if (topics) lines.push(`Topics they enjoy: ${topics}.`);
  if (extraNotes) lines.push(`\nAdditional notes from parent: ${extraNotes}`);
  lines.push('');
  lines.push(DEFAULT_CORE_INSTRUCTIONS);
  return lines.join('\n');
}

function parsePromptFields(systemPrompt) {
  if (!systemPrompt) return { structured: null, raw: systemPrompt || '' };
  const startIdx = systemPrompt.indexOf(CONFIG_PREFIX);
  if (startIdx === -1) return { structured: null, raw: systemPrompt };
  const jsonStart = startIdx + CONFIG_PREFIX.length;
  const endIdx = systemPrompt.indexOf(CONFIG_SUFFIX, jsonStart);
  if (endIdx === -1) return { structured: null, raw: systemPrompt };
  try {
    const json = systemPrompt.substring(jsonStart, endIdx).trim();
    const fields = JSON.parse(json);
    return { structured: fields, raw: systemPrompt };
  } catch {
    return { structured: null, raw: systemPrompt };
  }
}

// --- Routes ---

app.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('login', { error: 'Please enter username and password' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, username, password, status FROM sys_user WHERE username = ?',
      [username]
    );
    if (rows.length === 0) {
      return res.render('login', { error: 'Invalid username or password' });
    }
    const user = rows[0];
    if (user.status === 0) {
      return res.render('login', { error: 'Account is disabled' });
    }

    const hash = user.password || '';
    let valid = false;

    if (hash.startsWith('$2')) {
      valid = await bcrypt.compare(password, hash);
    } else {
      // Fallback: SHA-256 hex used by some xiaozhi-server forks
      const crypto = require('crypto');
      const sha = crypto.createHash('sha256').update(password).digest('hex');
      valid = (sha === hash);
    }

    if (!valid) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    req.session.userId = String(user.id);
    req.session.username = user.username;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Server error, please try again' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [devices] = await pool.query(
      `SELECT d.id, d.mac_address, d.alias, d.board, d.app_version,
              d.agent_id, d.last_connected_at,
              a.agent_name
       FROM ai_device d
       LEFT JOIN ai_agent a ON d.agent_id = a.id
       WHERE d.user_id = ? ORDER BY d.last_connected_at DESC`,
      [req.session.userId]
    );

    const macList = devices.map(d => d.mac_address).filter(Boolean);
    let recentSessions = [];

    if (macList.length > 0) {
      const [sessions] = await pool.query(
        `SELECT h.session_id, h.mac_address,
                MIN(h.created_at) AS started_at,
                MAX(h.created_at) AS last_msg_at,
                COUNT(*) AS message_count,
                (SELECT content FROM ai_agent_chat_history
                 WHERE session_id = h.session_id AND chat_type = 1
                 ORDER BY created_at ASC LIMIT 1) AS first_student_msg
         FROM ai_agent_chat_history h
         WHERE h.mac_address IN (?)
         GROUP BY h.session_id, h.mac_address
         ORDER BY last_msg_at DESC
         LIMIT 20`,
        [macList]
      );
      recentSessions = sessions;
    }

    const macToAlias = {};
    for (const d of devices) {
      macToAlias[d.mac_address] = d.alias || d.mac_address;
    }

    res.render('dashboard', {
      username: req.session.username,
      devices,
      recentSessions,
      macToAlias,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('error', { message: 'Failed to load dashboard' });
  }
});

app.get('/device/:mac', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;

    const [devRows] = await pool.query(
      'SELECT id, mac_address, alias, board FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Device not found' });
    const device = devRows[0];

    const [sessions] = await pool.query(
      `SELECT session_id,
              MIN(created_at) AS started_at,
              MAX(created_at) AS last_msg_at,
              COUNT(*) AS message_count
       FROM ai_agent_chat_history
       WHERE mac_address = ?
       GROUP BY session_id
       ORDER BY last_msg_at DESC
       LIMIT 50`,
      [mac]
    );

    res.render('device', {
      username: req.session.username,
      device,
      sessions,
    });
  } catch (err) {
    console.error('Device error:', err);
    res.status(500).render('error', { message: 'Failed to load device sessions' });
  }
});

app.get('/history/:sessionId', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    const [msgs] = await pool.query(
      `SELECT h.id, h.mac_address, h.chat_type, h.content, h.created_at
       FROM ai_agent_chat_history h
       WHERE h.session_id = ?
       ORDER BY h.created_at ASC`,
      [sessionId]
    );

    if (msgs.length === 0) {
      return res.render('history', {
        username: req.session.username,
        sessionId,
        messages: [],
        deviceName: 'Unknown',
      });
    }

    const firstMac = msgs[0].mac_address;
    const [devRows] = await pool.query(
      'SELECT mac_address, alias FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [firstMac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Access denied' });

    res.render('history', {
      username: req.session.username,
      sessionId,
      messages: msgs,
      deviceName: devRows[0].alias || devRows[0].mac_address,
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).render('error', { message: 'Failed to load chat history' });
  }
});

app.get('/device/:mac/stats', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT id, mac_address, alias, board FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Device not found' });
    const device = devRows[0];

    const [totals] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS total_sessions,
              COUNT(*) AS total_messages,
              SUM(chat_type = 1) AS student_messages,
              SUM(chat_type = 2) AS ai_messages,
              MIN(created_at) AS first_chat,
              MAX(created_at) AS last_chat
       FROM ai_agent_chat_history WHERE mac_address = ?`,
      [mac]
    );

    const [daily] = await pool.query(
      `SELECT DATE(created_at) AS day,
              COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) AS messages,
              SUM(chat_type = 1) AS student_msgs
       FROM ai_agent_chat_history
       WHERE mac_address = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [mac]
    );

    const [hourly] = await pool.query(
      `SELECT HOUR(created_at) AS hour, COUNT(*) AS messages
       FROM ai_agent_chat_history
       WHERE mac_address = ?
       GROUP BY HOUR(created_at)
       ORDER BY hour ASC`,
      [mac]
    );

    const [avgDuration] = await pool.query(
      `SELECT AVG(dur) AS avg_minutes FROM (
         SELECT TIMESTAMPDIFF(MINUTE, MIN(created_at), MAX(created_at)) AS dur
         FROM ai_agent_chat_history
         WHERE mac_address = ?
         GROUP BY session_id
         HAVING COUNT(*) > 1
       ) t`,
      [mac]
    );

    const dailyMap = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { day: key, sessions: 0, messages: 0, student_msgs: 0 };
    }
    for (const row of daily) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      if (dailyMap[key]) dailyMap[key] = { ...dailyMap[key], ...row, day: key };
    }
    const dailyData = Object.values(dailyMap);

    const hourlyData = Array.from({ length: 24 }, (_, i) => ({ hour: i, messages: 0 }));
    for (const row of hourly) hourlyData[row.hour].messages = row.messages;

    res.render('stats', {
      username: req.session.username,
      device,
      totals: totals[0],
      dailyData,
      hourlyData,
      avgMinutes: avgDuration[0]?.avg_minutes ? Math.round(avgDuration[0].avg_minutes) : 0,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).render('error', { message: 'Failed to load statistics' });
  }
});

app.get('/device/:mac/settings', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT id, mac_address, alias, agent_id FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Device not found' });
    const device = devRows[0];
    if (!device.agent_id) return res.render('error', { message: 'No AI agent linked to this device' });

    const [agentRows] = await pool.query(
      'SELECT id, system_prompt FROM ai_agent WHERE id = ?',
      [device.agent_id]
    );
    if (agentRows.length === 0) return res.render('error', { message: 'Agent not found' });

    const { structured, raw } = parsePromptFields(agentRows[0].system_prompt);

    res.render('device-settings', {
      username: req.session.username,
      device,
      structured,
      rawPrompt: raw,
      success: req.query.saved === '1' ? 'Đã lưu thành công!' : null,
      error: null,
    });
  } catch (err) {
    console.error('Settings GET error:', err);
    res.status(500).render('error', { message: 'Failed to load settings' });
  }
});

app.post('/device/:mac/settings', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT id, mac_address, alias, agent_id FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Device not found' });
    const device = devRows[0];
    if (!device.agent_id) return res.render('error', { message: 'No AI agent linked to this device' });

    const mode = req.body.mode;
    let newPrompt;

    if (mode === 'structured') {
      newPrompt = buildPromptFromFields({
        childName: (req.body.childName || '').trim(),
        age: (req.body.age || '').trim(),
        level: (req.body.level || '').trim(),
        topics: (req.body.topics || '').trim(),
        extraNotes: (req.body.extraNotes || '').trim(),
      });
    } else {
      newPrompt = (req.body.rawPrompt || '').trim();
    }

    if (!newPrompt) {
      const { structured, raw } = parsePromptFields(newPrompt);
      return res.render('device-settings', {
        username: req.session.username,
        device,
        structured,
        rawPrompt: raw,
        success: null,
        error: 'Prompt không được để trống.',
      });
    }

    await pool.query(
      'UPDATE ai_agent SET system_prompt = ? WHERE id = ?',
      [newPrompt, device.agent_id]
    );

    res.redirect(`/device/${encodeURIComponent(mac)}/settings?saved=1`);
  } catch (err) {
    console.error('Settings POST error:', err);
    res.status(500).render('error', { message: 'Failed to save settings' });
  }
});

// ===========================================
// Phase 3: Device Status & Daily Summary
// ===========================================

app.get('/device/:mac/status', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      `SELECT d.id, d.mac_address, d.alias, d.board, d.app_version,
              d.agent_id, d.last_connected_at, a.agent_name
       FROM ai_device d
       LEFT JOIN ai_agent a ON d.agent_id = a.id
       WHERE d.mac_address = ? AND d.user_id = ?`,
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Device not found' });
    const device = devRows[0];

    const isOnline = device.last_connected_at &&
      (Date.now() - new Date(device.last_connected_at).getTime()) < 5 * 60 * 1000;

    const [totals] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS total_sessions,
              COUNT(*) AS total_messages,
              SUM(chat_type = 1) AS student_messages,
              SUM(chat_type = 2) AS ai_messages
       FROM ai_agent_chat_history WHERE mac_address = ?`,
      [mac]
    );

    const [todayStats] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) AS messages,
              SUM(chat_type = 1) AS student_msgs,
              MIN(created_at) AS first_msg,
              MAX(created_at) AS last_msg
       FROM ai_agent_chat_history
       WHERE mac_address = ? AND DATE(created_at) = CURDATE()`,
      [mac]
    );

    const [musicStats] = await pool.query(
      `SELECT COUNT(*) AS total_songs FROM parent_music WHERE user_id = ? OR user_id = 'system'`,
      [req.session.userId]
    );
    const [playlistStats] = await pool.query(
      'SELECT COUNT(*) AS total_playlists FROM parent_playlist WHERE user_id = ?',
      [req.session.userId]
    );
    const [scheduleStats] = await pool.query(
      'SELECT COUNT(*) AS active_schedules FROM parent_play_schedule WHERE user_id = ? AND is_active = 1',
      [req.session.userId]
    );

    const [lastTopic] = await pool.query(
      `SELECT content FROM ai_agent_chat_history
       WHERE mac_address = ? AND chat_type = 1 AND DATE(created_at) = CURDATE()
       ORDER BY created_at DESC LIMIT 1`,
      [mac]
    );

    res.render('device-status', {
      username: req.session.username,
      device,
      isOnline,
      totals: totals[0],
      today: todayStats[0],
      musicStats: musicStats[0],
      playlistStats: playlistStats[0],
      scheduleStats: scheduleStats[0],
      lastTopic: lastTopic.length > 0 ? lastTopic[0].content : null,
    });
  } catch (err) {
    console.error('Device status error:', err);
    res.status(500).render('error', { message: 'Failed to load device status' });
  }
});

app.get('/api/device/:mac/status', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      `SELECT d.last_connected_at, d.app_version, a.agent_name
       FROM ai_device d LEFT JOIN ai_agent a ON d.agent_id = a.id
       WHERE d.mac_address = ? AND d.user_id = ?`,
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).json({ error: 'Not found' });
    const dev = devRows[0];
    const isOnline = dev.last_connected_at &&
      (Date.now() - new Date(dev.last_connected_at).getTime()) < 5 * 60 * 1000;

    const [todayStats] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) AS messages,
              SUM(chat_type = 1) AS student_msgs
       FROM ai_agent_chat_history
       WHERE mac_address = ? AND DATE(created_at) = CURDATE()`,
      [mac]
    );

    res.json({
      isOnline,
      lastConnected: dev.last_connected_at,
      appVersion: dev.app_version,
      agentName: dev.agent_name,
      today: todayStats[0],
    });
  } catch (err) {
    console.error('API status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/device/:mac/daily-summary', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devCheck] = await pool.query(
      'SELECT id FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devCheck.length === 0) return res.status(403).json({ error: 'Not found' });

    const [today] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) AS messages,
              SUM(chat_type = 1) AS student_msgs,
              SUM(chat_type = 2) AS ai_msgs,
              MIN(created_at) AS first_msg,
              MAX(created_at) AS last_msg
       FROM ai_agent_chat_history
       WHERE mac_address = ? AND DATE(created_at) = CURDATE()`,
      [mac]
    );

    const [lastWords] = await pool.query(
      `SELECT content FROM ai_agent_chat_history
       WHERE mac_address = ? AND chat_type = 1 AND DATE(created_at) = CURDATE()
       ORDER BY created_at DESC LIMIT 3`,
      [mac]
    );

    const t = today[0];
    let activeMinutes = 0;
    if (t.first_msg && t.last_msg) {
      activeMinutes = Math.round((new Date(t.last_msg) - new Date(t.first_msg)) / 60000);
    }

    res.json({
      sessions: t.sessions || 0,
      messages: t.messages || 0,
      studentMessages: t.student_msgs || 0,
      aiMessages: t.ai_msgs || 0,
      activeMinutes,
      recentWords: lastWords.map(w => w.content),
    });
  } catch (err) {
    console.error('Daily summary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===========================================
// Phase 2: Music & Playlist routes
// ===========================================

const MUSIC_CATEGORIES = [
  { value: 'phonics', label: 'Phonics' },
  { value: 'nursery', label: 'Nursery Rhymes' },
  { value: 'vocabulary', label: 'Vocabulary' },
  { value: 'stories', label: 'Stories' },
  { value: 'songs', label: 'English Songs' },
  { value: 'general', label: 'General' },
];

// --- Music Library ---
app.get('/music', requireAuth, async (req, res) => {
  try {
    const cat = req.query.category || '';
    let query = 'SELECT * FROM parent_music WHERE (user_id = ? OR user_id = ?)';
    const params = [req.session.userId, 'system'];
    if (cat) { query += ' AND category = ?'; params.push(cat); }
    query += ' ORDER BY sort_order ASC, created_at DESC';
    const [songs] = await pool.query(query, params);

    res.render('music', {
      username: req.session.username,
      songs,
      categories: MUSIC_CATEGORIES,
      activeCategory: cat,
    });
  } catch (err) {
    console.error('Music list error:', err);
    res.status(500).render('error', { message: 'Failed to load music library' });
  }
});

app.post('/music/upload', requireAuth, (req, res, next) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).render('error', { message: 'File quá lớn! Tối đa 100MB mỗi file.' });
      }
      return res.status(400).render('error', { message: 'Upload lỗi: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const category = req.body.category || 'general';
    for (const file of (req.files || [])) {
      const title = req.body.title || path.basename(file.originalname, path.extname(file.originalname));
      const artist = req.body.artist || '';
      await pool.query(
        `INSERT INTO parent_music (user_id, title, artist, category, filename, original_name, file_size)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.session.userId, title, artist, category, file.filename, file.originalname, file.size]
      );
    }
    res.redirect('/music' + (category !== 'general' ? '?category=' + category : ''));
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).render('error', { message: 'Upload failed' });
  }
});

app.post('/music/:id/delete', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT filename FROM parent_music WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
    );
    if (rows.length > 0) {
      const filepath = path.join(MUSIC_DIR, rows[0].filename);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      await pool.query('DELETE FROM parent_music WHERE id = ?', [req.params.id]);
    }
    res.redirect('/music');
  } catch (err) {
    console.error('Delete music error:', err);
    res.status(500).render('error', { message: 'Delete failed' });
  }
});

// --- Music streaming ---
app.get('/api/music/stream/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT filename, original_name FROM parent_music WHERE id = ? AND (user_id = ? OR user_id = ?)',
      [req.params.id, req.session.userId, 'system']
    );
    if (rows.length === 0) return res.status(404).send('Not found');
    const filepath = path.join(MUSIC_DIR, rows[0].filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('File not found');

    const stat = fs.statSync(filepath);
    const ext = path.extname(rows[0].filename).toLowerCase();
    const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
    const mime = mimeMap[ext] || 'audio/mpeg';

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
      });
      fs.createReadStream(filepath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filepath).pipe(res);
    }
  } catch (err) {
    console.error('Stream error:', err);
    res.status(500).send('Stream error');
  }
});

// --- Playlists ---
app.get('/playlists', requireAuth, async (req, res) => {
  try {
    const [playlists] = await pool.query(
      `SELECT p.*, COUNT(pi.id) AS song_count
       FROM parent_playlist p
       LEFT JOIN parent_playlist_item pi ON pi.playlist_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    res.render('playlists', { username: req.session.username, playlists });
  } catch (err) {
    console.error('Playlists error:', err);
    res.status(500).render('error', { message: 'Failed to load playlists' });
  }
});

app.post('/playlists', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.redirect('/playlists');
    await pool.query(
      'INSERT INTO parent_playlist (user_id, name, description) VALUES (?, ?, ?)',
      [req.session.userId, name.trim(), (description || '').trim()]
    );
    res.redirect('/playlists');
  } catch (err) {
    console.error('Create playlist error:', err);
    res.status(500).render('error', { message: 'Failed to create playlist' });
  }
});

app.get('/playlists/:id', requireAuth, async (req, res) => {
  try {
    const [plRows] = await pool.query(
      'SELECT * FROM parent_playlist WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
    );
    if (plRows.length === 0) return res.status(404).render('error', { message: 'Playlist not found' });
    const playlist = plRows[0];

    const [items] = await pool.query(
      `SELECT pi.id AS item_id, pi.sort_order, m.*
       FROM parent_playlist_item pi
       JOIN parent_music m ON m.id = pi.music_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.sort_order ASC, m.title ASC`,
      [playlist.id]
    );

    const [allSongs] = await pool.query(
      'SELECT id, title, artist, category FROM parent_music WHERE (user_id = ? OR user_id = ?) ORDER BY title ASC',
      [req.session.userId, 'system']
    );

    const inPlaylist = new Set(items.map(i => i.id));
    const availableSongs = allSongs.filter(s => !inPlaylist.has(s.id));

    res.render('playlist-detail', {
      username: req.session.username,
      playlist,
      items,
      availableSongs,
    });
  } catch (err) {
    console.error('Playlist detail error:', err);
    res.status(500).render('error', { message: 'Failed to load playlist' });
  }
});

app.post('/playlists/:id/add-song', requireAuth, async (req, res) => {
  try {
    const playlistId = req.params.id;
    const musicId = req.body.music_id;
    const [plRows] = await pool.query(
      'SELECT id FROM parent_playlist WHERE id = ? AND user_id = ?',
      [playlistId, req.session.userId]
    );
    if (plRows.length === 0) return res.status(403).send('Not allowed');

    const [maxOrder] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM parent_playlist_item WHERE playlist_id = ?',
      [playlistId]
    );
    await pool.query(
      'INSERT INTO parent_playlist_item (playlist_id, music_id, sort_order) VALUES (?, ?, ?)',
      [playlistId, musicId, maxOrder[0].next_order]
    );
    res.redirect(`/playlists/${playlistId}`);
  } catch (err) {
    console.error('Add song error:', err);
    res.status(500).render('error', { message: 'Failed to add song' });
  }
});

app.post('/playlists/:id/remove-song', requireAuth, async (req, res) => {
  try {
    const playlistId = req.params.id;
    const itemId = req.body.item_id;
    const [plRows] = await pool.query(
      'SELECT id FROM parent_playlist WHERE id = ? AND user_id = ?',
      [playlistId, req.session.userId]
    );
    if (plRows.length === 0) return res.status(403).send('Not allowed');
    await pool.query('DELETE FROM parent_playlist_item WHERE id = ? AND playlist_id = ?', [itemId, playlistId]);
    res.redirect(`/playlists/${playlistId}`);
  } catch (err) {
    console.error('Remove song error:', err);
    res.status(500).render('error', { message: 'Failed to remove song' });
  }
});

app.post('/playlists/:id/delete', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM parent_playlist WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]);
    res.redirect('/playlists');
  } catch (err) {
    console.error('Delete playlist error:', err);
    res.status(500).render('error', { message: 'Failed to delete playlist' });
  }
});

// --- Play Schedule ---
app.get('/schedules', requireAuth, async (req, res) => {
  try {
    const [devices] = await pool.query(
      'SELECT mac_address, alias FROM ai_device WHERE user_id = ?', [req.session.userId]
    );
    const [playlists] = await pool.query(
      'SELECT id, name FROM parent_playlist WHERE user_id = ?', [req.session.userId]
    );
    const [schedules] = await pool.query(
      `SELECT s.*, p.name AS playlist_name, d.alias AS device_name
       FROM parent_play_schedule s
       LEFT JOIN parent_playlist p ON p.id = s.playlist_id
       LEFT JOIN ai_device d ON d.mac_address = s.mac_address
       WHERE s.user_id = ?
       ORDER BY s.start_time ASC`,
      [req.session.userId]
    );
    res.render('schedules', {
      username: req.session.username,
      schedules,
      devices,
      playlists,
    });
  } catch (err) {
    console.error('Schedules error:', err);
    res.status(500).render('error', { message: 'Failed to load schedules' });
  }
});

app.post('/schedules', requireAuth, async (req, res) => {
  try {
    const { mac_address, playlist_id, start_time, end_time, days_of_week } = req.body;
    const days = Array.isArray(days_of_week) ? days_of_week.join(',') : (days_of_week || '1,2,3,4,5,6,7');
    await pool.query(
      `INSERT INTO parent_play_schedule (user_id, mac_address, playlist_id, start_time, end_time, days_of_week)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.session.userId, mac_address, playlist_id, start_time, end_time, days]
    );
    res.redirect('/schedules');
  } catch (err) {
    console.error('Create schedule error:', err);
    res.status(500).render('error', { message: 'Failed to create schedule' });
  }
});

app.post('/schedules/:id/toggle', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE parent_play_schedule SET is_active = NOT is_active WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
    );
    res.redirect('/schedules');
  } catch (err) {
    console.error('Toggle schedule error:', err);
    res.status(500).render('error', { message: 'Failed to toggle schedule' });
  }
});

app.post('/schedules/:id/delete', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM parent_play_schedule WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]);
    res.redirect('/schedules');
  } catch (err) {
    console.error('Delete schedule error:', err);
    res.status(500).render('error', { message: 'Failed to delete schedule' });
  }
});

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Parent Dashboard running on http://0.0.0.0:${PORT}`);
});
