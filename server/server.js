const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const session = require("express-session");
const pgSessionFactory = require("connect-pg-simple");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { requireAuth } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const VALID_ZONES = [550, 1300, 2200, 3333];
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));

const PgSession = pgSessionFactory(session);
app.use(
  session({
    store: new PgSession({ pool: db.pool, tableName: "session", createTableIfMissing: true }),
    name: "tdfi.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

// Serverless cold starts need the schema created before the first query;
// this is cheap after the first call since db.init() caches its promise.
app.use("/api", async (req, res, next) => {
  try {
    await db.init();
    next();
  } catch (err) {
    console.error("DB init failed:", err);
    res.status(500).json({ error: "Database is not reachable." });
  }
});

app.use(express.static(path.join(__dirname, "..", "frontend"), { index: "home.html" }));
app.use(express.static(path.join(__dirname, "..")));

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    stravaId: row.strava_id,
    zone: row.zone,
    createdAt: row.created_at,
  };
}

function publicRide(row) {
  return {
    id: row.id,
    stageDate: row.stage_date,
    stravaLink: row.strava_link,
    distanceKm: row.distance_km,
    timeMin: row.time_min,
    elevationM: row.elevation_m,
    photo: row.photo,
    createdAt: row.created_at,
  };
}

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, fullName, email, phone, city, stravaId, zone } = req.body || {};

    if (!username || !password || !fullName || !email) {
      return res.status(400).json({ error: "Full name, email, username and password are required." });
    }
    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3-20 characters (letters, numbers, _ or .)." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    const zoneNum = zone ? Number(zone) : null;
    if (zoneNum !== null && !VALID_ZONES.includes(zoneNum)) {
      return res.status(400).json({ error: "Invalid distance zone." });
    }

    const { rows: existingRows } = await db.pool.query(
      "SELECT id FROM users WHERE username = $1 OR email = $2",
      [username, email]
    );
    if (existingRows.length) {
      return res.status(409).json({ error: "Username or email is already registered." });
    }

    const passwordHash = bcrypt.hashSync(String(password), 10);
    const { rows } = await db.pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, phone, city, strava_id, zone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [username, passwordHash, fullName, email, phone || null, city || null, stravaId || null, zoneNum]
    );

    const user = rows[0];
    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const identifier = (email || username || "").trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const { rows } = await db.pool.query(
      "SELECT * FROM users WHERE username = $1 OR email = $2",
      [identifier, identifier]
    );
    const user = rows[0];
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("tdfi.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await db.pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load profile." });
  }
});

app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const { fullName, phone, city, stravaId, zone } = req.body || {};
    const zoneNum = zone ? Number(zone) : null;
    if (zoneNum !== null && !VALID_ZONES.includes(zoneNum)) {
      return res.status(400).json({ error: "Invalid distance zone." });
    }

    await db.pool.query(
      `UPDATE users SET full_name = COALESCE($1, full_name), phone = $2, city = $3, strava_id = $4, zone = $5 WHERE id = $6`,
      [fullName || null, phone || null, city || null, stravaId || null, zoneNum, req.session.userId]
    );

    const { rows } = await db.pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update profile." });
  }
});

app.post("/api/rides", requireAuth, async (req, res) => {
  try {
    const { stageDate, stravaLink, distanceKm, timeMin, elevationM, photo } = req.body || {};

    if (!stageDate || !/^\d{4}-\d{2}-\d{2}$/.test(stageDate)) {
      return res.status(400).json({ error: "A valid stage date is required." });
    }
    if (!stravaLink || !/strava\.com\//i.test(stravaLink)) {
      return res.status(400).json({ error: "A valid Strava activity link is required." });
    }
    if (!photo) {
      return res.status(400).json({ error: "A photo of your ride is required." });
    }

    const distNum = Number(distanceKm);
    const timeNum = Number(timeMin);
    const elevNum = Number(elevationM);
    if (!Number.isFinite(distNum) || distNum <= 0) {
      return res.status(400).json({ error: "A valid distance (km) is required." });
    }
    if (!Number.isFinite(timeNum) || timeNum <= 0) {
      return res.status(400).json({ error: "A valid time is required." });
    }
    if (!Number.isFinite(elevNum) || elevNum < 0) {
      return res.status(400).json({ error: "A valid elevation (m) is required." });
    }

    const { rows } = await db.pool.query(
      `INSERT INTO rides (user_id, stage_date, strava_link, distance_km, time_min, elevation_m, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, stage_date) DO UPDATE SET
         strava_link = EXCLUDED.strava_link,
         distance_km = EXCLUDED.distance_km,
         time_min = EXCLUDED.time_min,
         elevation_m = EXCLUDED.elevation_m,
         photo = EXCLUDED.photo
       RETURNING *`,
      [req.session.userId, stageDate, stravaLink, distNum, timeNum, elevNum, photo]
    );

    res.status(201).json({ ride: publicRide(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not submit your ride." });
  }
});

app.get("/api/rides/me", requireAuth, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "A valid date is required." });
    }
    const { rows } = await db.pool.query(
      "SELECT * FROM rides WHERE user_id = $1 AND stage_date = $2",
      [req.session.userId, date]
    );
    res.json({ ride: rows[0] ? publicRide(rows[0]) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not check today's ride." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const { rows } = await db.pool.query(
      `SELECT u.full_name AS "fullName", u.city AS city, u.zone AS zone,
              SUM(r.time_min)::int AS "timeMin", SUM(r.distance_km)::float AS "distanceKm",
              SUM(r.elevation_m)::float AS "elevationM", COUNT(DISTINCT r.stage_date)::int AS "daysLogged"
       FROM rides r
       JOIN users u ON u.id = r.user_id
       GROUP BY r.user_id, u.full_name, u.city, u.zone
       ORDER BY "timeMin" DESC`
    );
    res.json({ riders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the leaderboard." });
  }
});

module.exports = app;

if (require.main === module) {
  db.init()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Tour de France India server running at http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Failed to initialize database:", err);
      process.exit(1);
    });
}
