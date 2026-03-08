const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
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

    req.session.userId = Number(user.id);
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
      `SELECT id, mac_address, alias, board, app_version, agent_id, last_connected_at
       FROM ai_device WHERE user_id = ? ORDER BY last_connected_at DESC`,
      [req.session.userId]
    );

    const macList = devices.map(d => d.mac_address).filter(Boolean);
    let recentSessions = [];

    if (macList.length > 0) {
      const [sessions] = await pool.query(
        `SELECT session_id, mac_address,
                MIN(created_at) AS started_at,
                MAX(created_at) AS last_msg_at,
                COUNT(*) AS message_count
         FROM ai_agent_chat_history
         WHERE mac_address IN (?)
         GROUP BY session_id, mac_address
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

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Parent Dashboard running on http://0.0.0.0:${PORT}`);
});
