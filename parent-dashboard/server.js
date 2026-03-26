const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
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
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Session expired, please login again' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  if (!req.session.superAdmin) return res.status(403).render('error', { message: 'Chỉ admin mới có quyền truy cập.' });
  next();
}

app.use((req, res, next) => {
  res.locals.superAdmin = req.session.superAdmin || false;
  next();
});

// --- Music file upload ---
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, 'data', 'music');
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MUSIC_DIR),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      const ext = path.extname(file.originalname) || '.mp3';
      cb(null, unique + ext);
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
      'SELECT id, username, password, status, super_admin FROM sys_user WHERE username = ?',
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
      const sha = crypto.createHash('sha256').update(password).digest('hex');
      valid = (sha === hash);
    }

    if (!valid) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    req.session.userId = String(user.id);
    req.session.username = user.username;
    req.session.superAdmin = (user.super_admin === 1);
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

    // Auth check first: only load messages for devices owned by this user
    const [userDevices] = await pool.query(
      'SELECT mac_address, alias FROM ai_device WHERE user_id = ?',
      [req.session.userId]
    );
    const ownedMacs = new Set(userDevices.map(d => d.mac_address));

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
    if (!ownedMacs.has(firstMac)) {
      return res.status(403).render('error', { message: 'Access denied' });
    }

    const devInfo = userDevices.find(d => d.mac_address === firstMac);
    res.render('history', {
      username: req.session.username,
      sessionId,
      messages: msgs,
      deviceName: devInfo ? (devInfo.alias || devInfo.mac_address) : firstMac,
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).render('error', { message: 'Failed to load chat history' });
  }
});

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
              SUM(chat_type = 1) AS student_msgs
       FROM ai_agent_chat_history
       WHERE mac_address = ? AND DATE(created_at) = CURDATE()`,
      [mac]
    );

    const [musicStats] = await pool.query(
      'SELECT COUNT(*) AS total_songs FROM parent_music WHERE user_id = ?',
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

const VOICE_IDS_FOR_PARENTS = [
  'TTS_EdgeTTS_ML001', 'TTS_EdgeTTS_ML002', 'TTS_EdgeTTS_ML003',
  'TTS_EdgeTTS_EN001', 'TTS_EdgeTTS_EN002', 'TTS_EdgeTTS_EN004',
  'TTS_EdgeTTS_VI001',
];

const VOICE_META = {
  'TTS_EdgeTTS_ML001': { label: 'Ava', desc: 'Nữ - Đa ngôn ngữ', tag: 'Khuyên dùng', gender: 'female' },
  'TTS_EdgeTTS_ML002': { label: 'Emma', desc: 'Nữ - Đa ngôn ngữ', tag: 'Multilingual', gender: 'female' },
  'TTS_EdgeTTS_ML003': { label: 'Brian', desc: 'Nam - Đa ngôn ngữ', tag: 'Multilingual', gender: 'male' },
  'TTS_EdgeTTS_EN001': { label: 'Aria', desc: 'Nữ - Tiếng Anh (Mỹ)', tag: 'English', gender: 'female' },
  'TTS_EdgeTTS_EN002': { label: 'Guy', desc: 'Nam - Tiếng Anh (Mỹ)', tag: 'English', gender: 'male' },
  'TTS_EdgeTTS_EN004': { label: 'Sonia', desc: 'Nữ - Tiếng Anh (Anh)', tag: 'English UK', gender: 'female' },
  'TTS_EdgeTTS_VI001': { label: 'Hoài My', desc: 'Nữ - Tiếng Việt', tag: 'Tiếng Việt', gender: 'female' },
};

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
      'SELECT id, system_prompt, tts_voice_id FROM ai_agent WHERE id = ?',
      [device.agent_id]
    );
    if (agentRows.length === 0) return res.render('error', { message: 'Agent not found' });

    const { structured, raw } = parsePromptFields(agentRows[0].system_prompt);

    const [voiceRows] = await pool.query(
      'SELECT id, name, tts_voice, languages FROM ai_tts_voice WHERE id IN (?)',
      [VOICE_IDS_FOR_PARENTS]
    );
    const voices = VOICE_IDS_FOR_PARENTS.map(vid => {
      const row = voiceRows.find(r => r.id === vid);
      const meta = VOICE_META[vid] || {};
      return row ? { id: row.id, tts_voice: row.tts_voice, ...meta } : null;
    }).filter(Boolean);

    res.render('device-settings', {
      username: req.session.username,
      device,
      structured,
      rawPrompt: raw,
      voices,
      currentVoiceId: agentRows[0].tts_voice_id || '',
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
      const [agentRows] = await pool.query(
        'SELECT tts_voice_id FROM ai_agent WHERE id = ?', [device.agent_id]
      );
      const currentVoiceId = agentRows.length > 0 ? (agentRows[0].tts_voice_id || '') : '';

      const [voiceRows] = await pool.query(
        'SELECT id, name, tts_voice, languages FROM ai_tts_voice WHERE id IN (?)',
        [VOICE_IDS_FOR_PARENTS]
      );
      const voices = VOICE_IDS_FOR_PARENTS.map(vid => {
        const row = voiceRows.find(r => r.id === vid);
        const meta = VOICE_META[vid] || {};
        return row ? { id: row.id, tts_voice: row.tts_voice, ...meta } : null;
      }).filter(Boolean);

      const { structured, raw } = parsePromptFields('');
      return res.render('device-settings', {
        username: req.session.username,
        device,
        structured,
        rawPrompt: raw,
        voices,
        currentVoiceId,
        success: null,
        error: 'Prompt không được để trống.',
      });
    }

    const selectedVoice = (req.body.voiceId || '').trim();
    if (selectedVoice && VOICE_IDS_FOR_PARENTS.includes(selectedVoice)) {
      await pool.query(
        'UPDATE ai_agent SET system_prompt = ?, tts_voice_id = ? WHERE id = ?',
        [newPrompt, selectedVoice, device.agent_id]
      );
    } else {
      await pool.query(
        'UPDATE ai_agent SET system_prompt = ? WHERE id = ?',
        [newPrompt, device.agent_id]
      );
    }

    // Server uses in-memory prompt cache per connection.
    // Each device reconnect creates a fresh PromptManager that loads from DB.
    // No cache invalidation needed - changes apply on next device reconnect.

    res.redirect(`/device/${encodeURIComponent(mac)}/settings?saved=1`);
  } catch (err) {
    console.error('Settings POST error:', err);
    res.status(500).render('error', { message: 'Failed to save settings' });
  }
});

// --- Voice preview API ---
const { Communicate } = require('edge-tts-universal');
const PREVIEW_DIR = path.join(__dirname, 'data', 'voice-previews');
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const PREVIEW_TEXT = "Hello! My name is Teacher AI. Let's learn English together! Chào bé, hôm nay mình học gì nhé?";

async function generatePreview(ttsVoice, outputPath) {
  const comm = new Communicate(PREVIEW_TEXT, { voice: ttsVoice });
  const ws = fs.createWriteStream(outputPath);
  for await (const chunk of comm.stream()) {
    if (chunk.type === 'audio') ws.write(chunk.data);
  }
  ws.end();
  await new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

app.get('/api/voice/preview/:voiceId', requireAuth, async (req, res) => {
  try {
    const voiceId = req.params.voiceId;
    if (!VOICE_IDS_FOR_PARENTS.includes(voiceId)) {
      return res.status(400).json({ error: 'Invalid voice' });
    }

    const [rows] = await pool.query('SELECT tts_voice FROM ai_tts_voice WHERE id = ?', [voiceId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Voice not found' });

    const ttsVoice = rows[0].tts_voice;
    const voiceHash = crypto.createHash('md5').update(ttsVoice).digest('hex').slice(0, 8);
    const cacheFile = path.join(PREVIEW_DIR, `${voiceId}_${voiceHash}.mp3`);

    if (!fs.existsSync(cacheFile)) {
      // Remove old cache files for this voiceId (different voice mapping)
      try {
        const oldFiles = fs.readdirSync(PREVIEW_DIR).filter(f => f.startsWith(voiceId) && f !== path.basename(cacheFile));
        oldFiles.forEach(f => fs.unlinkSync(path.join(PREVIEW_DIR, f)));
      } catch (e) { /* ignore cleanup errors */ }
      await generatePreview(ttsVoice, cacheFile);
    }

    if (!fs.existsSync(cacheFile) || fs.statSync(cacheFile).size === 0) {
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
      return res.status(500).json({ error: 'Failed to generate preview' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(cacheFile).pipe(res);
  } catch (err) {
    console.error('Voice preview error:', err);
    res.status(500).json({ error: 'Preview generation failed' });
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
    let query = 'SELECT * FROM parent_music WHERE user_id = ?';
    const params = [req.session.userId];
    if (cat) { query += ' AND category = ?'; params.push(cat); }
    query += ' ORDER BY sort_order ASC, created_at DESC';
    const [songs] = await pool.query(query, params);

    const [devices] = await pool.query(
      'SELECT mac_address, alias FROM ai_device WHERE user_id = ?',
      [req.session.userId]
    );

    let sdFiles = [];
    const ownedMacs = new Set(devices.map(d => d.mac_address));
    const requestedMac = req.query.device || (devices.length > 0 ? devices[0].mac_address : '');
    const selectedMac = ownedMacs.has(requestedMac) ? requestedMac : (devices.length > 0 ? devices[0].mac_address : '');
    if (selectedMac) {
      let sdQuery = 'SELECT * FROM device_sd_files WHERE mac_address = ?';
      const sdParams = [selectedMac];
      if (cat) { sdQuery += ' AND category = ?'; sdParams.push(cat); }
      sdQuery += ' ORDER BY category ASC, filename ASC';
      [sdFiles] = await pool.query(sdQuery, sdParams);
    }

    res.render('music', {
      username: req.session.username,
      songs,
      categories: MUSIC_CATEGORIES,
      activeCategory: cat,
      devices,
      sdFiles,
      selectedMac,
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
      'SELECT filename, original_name FROM parent_music WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.userId]
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
      `SELECT pi.id AS item_id, pi.sort_order, pi.sd_file_id,
              COALESCE(m.id, 0) AS id,
              COALESCE(m.title, sd.filename) AS title,
              COALESCE(m.artist, '') AS artist,
              COALESCE(m.category, sd.category) AS category,
              IF(sd.id IS NOT NULL, 'sd', 'server') AS source
       FROM parent_playlist_item pi
       LEFT JOIN parent_music m ON m.id = pi.music_id
       LEFT JOIN device_sd_files sd ON sd.id = pi.sd_file_id
       WHERE pi.playlist_id = ?
       ORDER BY pi.sort_order ASC`,
      [playlist.id]
    );

    const [allSongs] = await pool.query(
      'SELECT id, title, artist, category FROM parent_music WHERE user_id = ? ORDER BY title ASC',
      [req.session.userId]
    );

    const [devices] = await pool.query(
      'SELECT mac_address, alias FROM ai_device WHERE user_id = ?',
      [req.session.userId]
    );

    let sdFiles = [];
    if (devices.length > 0) {
      const macs = devices.map(d => d.mac_address);
      [sdFiles] = await pool.query(
        'SELECT id, filename, category, mac_address FROM device_sd_files WHERE mac_address IN (?) ORDER BY filename ASC',
        [macs]
      );
    }

    const inPlaylistMusic = new Set(items.filter(i => !i.sd_file_id).map(i => i.id));
    const inPlaylistSd = new Set(items.filter(i => i.sd_file_id).map(i => i.sd_file_id));
    const availableSongs = allSongs.filter(s => !inPlaylistMusic.has(s.id));
    const availableSdFiles = sdFiles.filter(s => !inPlaylistSd.has(s.id));

    res.render('playlist-detail', {
      username: req.session.username,
      playlist,
      items,
      availableSongs,
      availableSdFiles,
      devices,
    });
  } catch (err) {
    console.error('Playlist detail error:', err);
    res.status(500).render('error', { message: 'Failed to load playlist' });
  }
});

app.post('/playlists/:id/add-song', requireAuth, async (req, res) => {
  try {
    const playlistId = req.params.id;
    const musicId = req.body.music_id || null;
    const sdFileId = req.body.sd_file_id || null;
    const [plRows] = await pool.query(
      'SELECT id FROM parent_playlist WHERE id = ? AND user_id = ?',
      [playlistId, req.session.userId]
    );
    if (plRows.length === 0) return res.status(403).send('Not allowed');

    if (musicId) {
      const [mRows] = await pool.query(
        'SELECT id FROM parent_music WHERE id = ? AND user_id = ?',
        [musicId, req.session.userId]
      );
      if (mRows.length === 0) return res.status(403).send('Music not found or not yours');
    }
    if (sdFileId) {
      const [sdRows] = await pool.query(
        `SELECT sd.id FROM device_sd_files sd
         JOIN ai_device d ON sd.mac_address = d.mac_address
         WHERE sd.id = ? AND d.user_id = ?`,
        [sdFileId, req.session.userId]
      );
      if (sdRows.length === 0) return res.status(403).send('SD file not found or not your device');
    }
    if (!musicId && !sdFileId) return res.status(400).send('No song selected');

    const [maxOrder] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM parent_playlist_item WHERE playlist_id = ?',
      [playlistId]
    );
    await pool.query(
      'INSERT INTO parent_playlist_item (playlist_id, music_id, sd_file_id, sort_order) VALUES (?, ?, ?, ?)',
      [playlistId, musicId, sdFileId, maxOrder[0].next_order]
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

    const [devCheck] = await pool.query(
      'SELECT mac_address FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac_address, req.session.userId]
    );
    if (devCheck.length === 0) return res.status(403).render('error', { message: 'Device not found' });

    const [plCheck] = await pool.query(
      'SELECT id FROM parent_playlist WHERE id = ? AND user_id = ?',
      [playlist_id, req.session.userId]
    );
    if (plCheck.length === 0) return res.status(403).render('error', { message: 'Playlist not found' });

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

// ===========================================
// SD Card Music -- file browser & sync
// ===========================================

app.get('/device/:mac/sd-files', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      `SELECT d.id, d.mac_address, d.alias, d.board, d.last_connected_at
       FROM ai_device d WHERE d.mac_address = ? AND d.user_id = ?`,
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).render('error', { message: 'Device not found' });
    const device = devRows[0];

    const cat = req.query.category || '';
    let query = 'SELECT * FROM device_sd_files WHERE mac_address = ?';
    const params = [mac];
    if (cat) { query += ' AND category = ?'; params.push(cat); }
    query += ' ORDER BY category ASC, filename ASC';
    const [files] = await pool.query(query, params);

    const [catRows] = await pool.query(
      'SELECT DISTINCT category FROM device_sd_files WHERE mac_address = ? ORDER BY category',
      [mac]
    );
    const categories = catRows.map(r => r.category);

    const isOnline = device.last_connected_at &&
      (Date.now() - new Date(device.last_connected_at).getTime()) < 5 * 60 * 1000;

    const [syncInfo] = await pool.query(
      'SELECT MAX(last_seen_at) AS last_sync FROM device_sd_files WHERE mac_address = ?',
      [mac]
    );

    res.render('sd-files', {
      username: req.session.username,
      device,
      files,
      categories,
      activeCategory: cat,
      isOnline,
      lastSync: syncInfo[0]?.last_sync || null,
    });
  } catch (err) {
    console.error('SD files error:', err);
    res.status(500).render('error', { message: 'Failed to load SD card files' });
  }
});

app.get('/api/device/:mac/sd-files.json', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT id FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).json({ error: 'Device not found' });

    const [files] = await pool.query(
      'SELECT * FROM device_sd_files WHERE mac_address = ? ORDER BY category ASC, filename ASC',
      [mac]
    );
    res.json({ files });
  } catch (err) {
    console.error('SD files JSON error:', err);
    res.status(500).json({ error: 'Failed to load SD files' });
  }
});

app.get('/api/device/:mac/status', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT last_connected_at FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).json({ error: 'Device not found' });

    const isOnline = devRows[0].last_connected_at &&
      (Date.now() - new Date(devRows[0].last_connected_at).getTime()) < 5 * 60 * 1000;

    const [todayStats] = await pool.query(
      `SELECT COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) AS messages,
              SUM(chat_type = 1) AS student_msgs
       FROM ai_agent_chat_history
       WHERE mac_address = ? AND DATE(created_at) = CURDATE()`,
      [mac]
    );

    res.json({ isOnline, today: todayStats[0] });
  } catch (err) {
    console.error('Device status API error:', err);
    res.status(500).json({ error: 'Failed to load status' });
  }
});

app.post('/device/:mac/sd-files/sync', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT id FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).json({ error: 'Device not found' });

    // For now, sync is triggered manually and the device reports back via MCP.
    // The actual MCP call happens through the xiaozhi-server when the device is online.
    // This endpoint stores/refreshes data when called with a file list from the device.
    const fileList = req.body.files;

    if (Array.isArray(fileList)) {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      for (const f of fileList) {
        const filepath = f.path || f.filepath || '';
        const filename = f.name || f.filename || path.basename(filepath, path.extname(filepath));
        const fileSize = f.size || f.file_size || 0;
        const parts = filepath.replace(/\\/g, '/').split('/').filter(Boolean);
        const parentDir = parts.length > 1 ? parts[parts.length - 2] : '';
        const category = (parentDir && parentDir !== 'sdcard') ? parentDir : 'general';

        await pool.query(
          `INSERT INTO device_sd_files (mac_address, filepath, filename, file_size, category, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE filename = VALUES(filename), file_size = VALUES(file_size),
                                    category = VALUES(category), last_seen_at = VALUES(last_seen_at)`,
          [mac, filepath, filename, fileSize, category, now]
        );
      }

      // Remove stale files not in the latest scan
      const activePaths = fileList.map(f => f.path || f.filepath).filter(Boolean);
      if (activePaths.length > 0) {
        await pool.query(
          'DELETE FROM device_sd_files WHERE mac_address = ? AND filepath NOT IN (?) AND last_seen_at < ?',
          [mac, activePaths, now]
        );
      }

      return res.json({ success: true, count: fileList.length });
    }

    res.json({ success: true, message: 'Sync request noted. Files will update when device responds.' });
  } catch (err) {
    console.error('SD sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// SD sync trigger - calls xiaozhi-server Python API to invoke MCP on device
app.post('/api/device/:mac/sd-sync', requireAuth, async (req, res) => {
  try {
    const mac = req.params.mac;
    const [devRows] = await pool.query(
      'SELECT id FROM ai_device WHERE mac_address = ? AND user_id = ?',
      [mac, req.session.userId]
    );
    if (devRows.length === 0) return res.status(403).json({ error: 'Device not found' });

    const XIAOZHI_HTTP = process.env.XIAOZHI_HTTP_URL || 'http://xiaozhi-esp32-server:8003';
    const url = `${XIAOZHI_HTTP}/api/sd-sync/${encodeURIComponent(mac)}`;
    console.log(`[SD-Sync] Calling xiaozhi-server: POST ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const syncHeaders = { 'Content-Type': 'application/json' };
    if (process.env.SD_SYNC_SECRET) {
      syncHeaders['X-Sync-Secret'] = process.env.SD_SYNC_SECRET;
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: syncHeaders,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
    console.log(`[SD-Sync] Response (${resp.status}):`, JSON.stringify(data).slice(0, 300));
    // Always return 200 to avoid Cloudflare replacing error pages with HTML
    if (resp.ok) {
      res.json(data);
    } else {
      res.json({ success: false, error: data.error || `Server error (${resp.status})`, ...data });
    }
  } catch (err) {
    console.error('[SD-Sync] Error:', err.message);
    const msg = err.name === 'AbortError'
      ? 'Timeout: thiết bị không phản hồi (20s). Device có thể offline hoặc chưa hỗ trợ SD sync.'
      : `Không thể kết nối xiaozhi-server: ${err.message}`;
    res.json({ success: false, error: msg });
  }
});

// ===========================================
// Admin Panel routes
// ===========================================

const TEMPLATE_AGENT_ID = '364609f2c11d489f9dd9e561df3d0568';

function generateId() {
  const ts = BigInt(Date.now()) << 22n;
  const rand = BigInt(Math.floor(Math.random() * 4194304));
  return (ts | rand).toString();
}

function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const [parents] = await pool.query(
      `SELECT u.id, u.username, u.status, u.create_date,
              COUNT(d.id) AS device_count
       FROM sys_user u
       LEFT JOIN ai_device d ON d.user_id = u.id
       WHERE u.super_admin = 0
       GROUP BY u.id
       ORDER BY u.create_date DESC`
    );

    const [devices] = await pool.query(
      `SELECT d.id, d.mac_address, d.alias, d.agent_id, d.user_id,
              d.last_connected_at, d.board, d.app_version,
              a.agent_name,
              u.username AS owner_name
       FROM ai_device d
       LEFT JOIN ai_agent a ON d.agent_id = a.id
       LEFT JOIN sys_user u ON d.user_id = u.id
       ORDER BY d.create_date DESC`
    );

    const [agents] = await pool.query(
      `SELECT a.id, a.agent_name, COUNT(d.id) AS device_count
       FROM ai_agent a
       LEFT JOIN ai_device d ON d.agent_id = a.id
       GROUP BY a.id
       ORDER BY a.agent_name`
    );

    res.render('admin', {
      username: req.session.username,
      parents,
      devices,
      agents,
      success: req.query.success === '1' ? 'Thao tác thành công!' : null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).render('error', { message: 'Failed to load admin panel' });
  }
});

app.post('/admin/parents', requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.redirect('/admin?error=' + encodeURIComponent('Username và password không được để trống'));
    }

    const [existing] = await pool.query('SELECT id FROM sys_user WHERE username = ?', [username.trim()]);
    if (existing.length > 0) {
      return res.redirect('/admin?error=' + encodeURIComponent('Username đã tồn tại'));
    }

    const hash = await bcrypt.hash(password, 10);
    const id = generateId();

    await pool.query(
      `INSERT INTO sys_user (id, username, password, super_admin, status, creator, create_date, updater, update_date)
       VALUES (?, ?, ?, 0, 1, ?, NOW(), ?, NOW())`,
      [id, username.trim(), hash, req.session.userId, req.session.userId]
    );

    res.redirect('/admin?success=1');
  } catch (err) {
    console.error('Create parent error:', err);
    res.redirect('/admin?error=' + encodeURIComponent('Lỗi tạo tài khoản: ' + err.message));
  }
});

app.post('/admin/devices/:mac/assign', requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    const mac = req.params.mac;
    await pool.query('UPDATE ai_device SET user_id = ? WHERE mac_address = ?', [user_id, mac]);
    res.redirect('/admin?success=1');
  } catch (err) {
    console.error('Assign device error:', err);
    res.redirect('/admin?error=' + encodeURIComponent('Lỗi gán thiết bị: ' + err.message));
  }
});

app.post('/admin/devices/:mac/create-agent', requireAdmin, async (req, res) => {
  try {
    const mac = req.params.mac;
    const agentName = (req.body.agent_name || '').trim() || 'EnglishTeacher';

    const [template] = await pool.query(
      'SELECT system_prompt, chat_history_conf, tts_model_id, tts_voice_id, asr_model_id, llm_model_id, mem_model_id, intent_model_id FROM ai_agent WHERE id = ?',
      [TEMPLATE_AGENT_ID]
    );
    const t = template.length > 0 ? template[0] : {};
    const systemPrompt = t.system_prompt || DEFAULT_CORE_INSTRUCTIONS;
    const chatHistoryConf = t.chat_history_conf || 1;

    const newId = generateUUID();
    await pool.query(
      `INSERT INTO ai_agent (id, agent_name, system_prompt, chat_history_conf, tts_model_id, tts_voice_id, asr_model_id, llm_model_id, mem_model_id, intent_model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, agentName, systemPrompt, chatHistoryConf, t.tts_model_id, t.tts_voice_id, t.asr_model_id, t.llm_model_id, t.mem_model_id, t.intent_model_id || 'Intent_function_call']
    );

    await pool.query('UPDATE ai_device SET agent_id = ? WHERE mac_address = ?', [newId, mac]);

    res.redirect('/admin?success=1');
  } catch (err) {
    console.error('Create agent error:', err);
    res.redirect('/admin?error=' + encodeURIComponent('Lỗi tạo agent: ' + err.message));
  }
});

app.post('/admin/devices/:mac/assign-agent', requireAdmin, async (req, res) => {
  try {
    const { agent_id } = req.body;
    const mac = req.params.mac;
    await pool.query('UPDATE ai_device SET agent_id = ? WHERE mac_address = ?', [agent_id, mac]);
    res.redirect('/admin?success=1');
  } catch (err) {
    console.error('Assign agent error:', err);
    res.redirect('/admin?error=' + encodeURIComponent('Lỗi gán agent: ' + err.message));
  }
});

app.post('/admin/quick-setup', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { mac_address, parent_mode, parent_id, parent_username, parent_password, agent_name } = req.body;

    if (!mac_address) {
      await conn.rollback();
      return res.redirect('/admin?error=' + encodeURIComponent('Chưa chọn thiết bị'));
    }

    let userId = parent_id;

    if (parent_mode === 'new') {
      if (!parent_username || !parent_password) {
        await conn.rollback();
        return res.redirect('/admin?error=' + encodeURIComponent('Username và password không được để trống'));
      }
      const [existing] = await conn.query('SELECT id FROM sys_user WHERE username = ?', [parent_username.trim()]);
      if (existing.length > 0) {
        await conn.rollback();
        return res.redirect('/admin?error=' + encodeURIComponent('Username đã tồn tại'));
      }

      const hash = await bcrypt.hash(parent_password, 10);
      userId = generateId();
      await conn.query(
        `INSERT INTO sys_user (id, username, password, super_admin, status, creator, create_date, updater, update_date)
         VALUES (?, ?, ?, 0, 1, ?, NOW(), ?, NOW())`,
        [userId, parent_username.trim(), hash, req.session.userId, req.session.userId]
      );
    }

    const [template] = await conn.query(
      'SELECT system_prompt, chat_history_conf, tts_model_id, tts_voice_id, asr_model_id, llm_model_id, mem_model_id, intent_model_id FROM ai_agent WHERE id = ?',
      [TEMPLATE_AGENT_ID]
    );
    const t = template.length > 0 ? template[0] : {};
    const systemPrompt = t.system_prompt || DEFAULT_CORE_INSTRUCTIONS;
    const chatHistoryConf = t.chat_history_conf || 1;

    const newAgentId = generateUUID();
    const finalAgentName = (agent_name || '').trim() || 'EnglishTeacher';
    await conn.query(
      `INSERT INTO ai_agent (id, agent_name, system_prompt, chat_history_conf, tts_model_id, tts_voice_id, asr_model_id, llm_model_id, mem_model_id, intent_model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newAgentId, finalAgentName, systemPrompt, chatHistoryConf, t.tts_model_id, t.tts_voice_id, t.asr_model_id, t.llm_model_id, t.mem_model_id, t.intent_model_id || 'Intent_function_call']
    );

    await conn.query(
      'UPDATE ai_device SET user_id = ?, agent_id = ? WHERE mac_address = ?',
      [userId, newAgentId, mac_address]
    );

    await conn.commit();
    res.redirect('/admin?success=1');
  } catch (err) {
    await conn.rollback();
    console.error('Quick setup error:', err);
    res.redirect('/admin?error=' + encodeURIComponent('Lỗi quick setup: ' + err.message));
  } finally {
    conn.release();
  }
});

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Parent Dashboard running on http://0.0.0.0:${PORT}`);
});
