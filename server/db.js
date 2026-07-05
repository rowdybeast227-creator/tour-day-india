const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to server/.env (locally) or your host's environment variables.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// A pooled/idle client can drop (network blip, the provider recycling the
// connection, etc.) at any time. Without this listener, pg's default
// behavior is to treat that as an unhandled error and crash the process.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err.message);
});

let initPromise = null;

function init() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        city TEXT,
        strava_id TEXT,
        zone INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS rides (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        stage_date TEXT NOT NULL,
        strava_link TEXT NOT NULL,
        distance_km REAL,
        time_min INTEGER,
        elevation_m REAL,
        photo TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, stage_date)
      );
    `);
  }
  return initPromise;
}

module.exports = { pool, init };
