-- confmap schema. Shared cache of public bibliometric data + per-user tracking.

-- Conference metadata (ranks, editions, deadlines, acceptance rates) from ccfddl. Seeded by 0003_confs.sql.
CREATE TABLE confs (
  key         TEXT PRIMARY KEY,      -- dblp key or lowercased title
  title       TEXT NOT NULL,         -- short name, e.g. NeurIPS
  description TEXT,                  -- full name
  sub         TEXT,                  -- ccfddl area code (AI, DB, SE, ...)
  core        TEXT,                  -- CORE rank: A*, A, B, C
  ccf         TEXT,                  -- CCF rank: A, B, C
  dblp        TEXT,
  editions    TEXT NOT NULL DEFAULT '[]',   -- JSON [{year, link, date, place, timezone, timeline:[{deadline,...}]}]
  accept      TEXT                          -- JSON [{year, submitted, accepted, rate}]
);

-- OpenAlex authors (shared cache).
CREATE TABLE authors (
  id          TEXT PRIMARY KEY,      -- OpenAlex id, e.g. A5049349154
  name        TEXT NOT NULL,
  orcid       TEXT,
  institution TEXT,
  country     TEXT,
  h_index     INTEGER NOT NULL DEFAULT 0,
  i10_index   INTEGER NOT NULL DEFAULT 0,
  cited_by    INTEGER NOT NULL DEFAULT 0,
  works_count INTEGER NOT NULL DEFAULT 0,
  mean2yr     REAL NOT NULL DEFAULT 0,
  topics      TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, subfield, field, count}]
  keywords    TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, count}]
  by_year     TEXT NOT NULL DEFAULT '[]',   -- JSON [{year, works, cites}]
  fetched_at  INTEGER                       -- NULL = only a stub (seen at a venue), not fully ingested
);
CREATE INDEX authors_name ON authors(name);

-- OpenAlex sources (conferences and journals).
CREATE TABLE venues (
  id          TEXT PRIMARY KEY,      -- OpenAlex id, e.g. S4363606243
  name        TEXT NOT NULL,
  abbr        TEXT,
  type        TEXT,                  -- conference | journal
  h_index     INTEGER NOT NULL DEFAULT 0,
  mean2yr     REAL NOT NULL DEFAULT 0,
  works_count INTEGER NOT NULL DEFAULT 0,
  cited_by    INTEGER NOT NULL DEFAULT 0,
  homepage    TEXT,
  conf_key    TEXT REFERENCES confs(key),
  people      TEXT,                  -- JSON top authors at this venue in recent years (cached)
  people_at   INTEGER,
  fetched_at  INTEGER NOT NULL
);

-- How often an author published at a venue.
CREATE TABLE author_venues (
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  venue_id  TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  n_all     INTEGER NOT NULL DEFAULT 0,
  n_recent  INTEGER NOT NULL DEFAULT 0,   -- last 4 years
  PRIMARY KEY (author_id, venue_id)
);
CREATE INDEX author_venues_venue ON author_venues(venue_id);

-- A sample of each author's papers: most cited and most recent.
CREATE TABLE works (
  id        TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,           -- top | recent
  title     TEXT NOT NULL,
  year      INTEGER,
  cites     INTEGER NOT NULL DEFAULT 0,
  venue_id  TEXT,
  venue     TEXT,
  url       TEXT,
  PRIMARY KEY (author_id, kind, id)
);

-- Per-user data -----------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN tz TEXT;

CREATE TABLE tracked (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES authors(id),
  source     TEXT,                   -- the link or name it was added from
  note       TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, author_id)
);

CREATE TABLE venue_marks (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  priority INTEGER NOT NULL DEFAULT 4,   -- 1 (top) .. 4 (none), Todoist-style
  note     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  due        TEXT,                   -- YYYY-MM-DD in the user's zone
  priority   INTEGER NOT NULL DEFAULT 4,
  venue_id   TEXT REFERENCES venues(id),
  done_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX tasks_user ON tasks(user_id, done_at);

-- Personal access tokens for the MCP endpoint (Claude Code, Codex, ...). Only a SHA-256 hash is stored.
CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,        -- last 4 chars, for display
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
