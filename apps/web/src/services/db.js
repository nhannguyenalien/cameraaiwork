const sqlite3 = require("sqlite3").verbose();
const config = require("../config");

const db = new sqlite3.Database(config.db.path);

db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT (datetime('now','localtime')),
    type TEXT,
    video_link TEXT
)`);

function insertEvent(type, videoLink) {
  db.run("INSERT INTO events (type, video_link) VALUES (?, ?)", [type, videoLink]);
}

function getRecentEvents(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

module.exports = { insertEvent, getRecentEvents };
