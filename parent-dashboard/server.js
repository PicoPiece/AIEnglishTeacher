const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
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

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Parent Dashboard running on http://0.0.0.0:${PORT}`);
});
