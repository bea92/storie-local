const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const db = new sqlite3.Database("storie.db");

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const seedStories = [
  `Quel galleggiante arancione lo avevo messo io, il primo anno che lavoravo qui. Era il 1989. Lo sistemavo ogni mattina, controllavo la catena, mi assicuravo che reggesse. Una notte di ottobre se n'è andato con la mareggiata. Non so perché mi ha fatto così effetto — era solo un pezzo di plastica. Ma era anche trentadue anni di confine, di bambini tenuti al sicuro, di estati sorvegliate. Ho chiamato il fornitore il giorno dopo per ordinarne uno nuovo. Non ho detto niente a nessuno di come mi sentivo.`
];

function ensureColumn(table, column, definition) {
  db.all(`PRAGMA table_info(${table})`, (err, columns) => {
    if (err) return console.error(err);
    const exists = columns.some(c => c.name === column);
    if (!exists) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, err => {
        if (err) console.error(err);
      });
    }
  });
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'original',
    photo_code TEXT,
    parent_story_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(parent_story_id) REFERENCES stories(id)
  )`);

  ensureColumn("stories", "photo_code", "TEXT");
  ensureColumn("stories", "parent_story_id", "INTEGER");

  db.run(`CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_story_id INTEGER NOT NULL,
    assigned_story_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(participant_story_id) REFERENCES stories(id),
    FOREIGN KEY(assigned_story_id) REFERENCES stories(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS continuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    participant_story_id INTEGER NOT NULL,
    assigned_story_id INTEGER NOT NULL,
    continuation_story_id INTEGER,
    sentence TEXT NOT NULL,
    photo_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assignment_id) REFERENCES assignments(id),
    FOREIGN KEY(participant_story_id) REFERENCES stories(id),
    FOREIGN KEY(assigned_story_id) REFERENCES stories(id),
    FOREIGN KEY(continuation_story_id) REFERENCES stories(id)
  )`);

  ensureColumn("continuations", "photo_code", "TEXT");

  db.get("SELECT COUNT(*) AS count FROM stories", (err, row) => {
    if (err) return console.error(err);

    if (row.count === 0) {
      const stmt = db.prepare(
        "INSERT INTO stories(text, kind, photo_code, parent_story_id) VALUES (?, 'seed', ?, NULL)"
      );

      seedStories.forEach((story, index) => {
        stmt.run(story, `SEED-${String(index + 1).padStart(2, "0")}`);
      });

      stmt.finalize();
    }
  });
});

app.post("/api/story", (req, res) => {
  const text = String(req.body.text || "").trim();
  const photoCode = String(req.body.photo_code || "").trim();

  if (!text) {
    return res.status(400).json({ error: "Testo mancante." });
  }

  if (!photoCode) {
    return res.status(400).json({ error: "Codice foto mancante." });
  }

  // La storia assegnata e il parent_story_id sono sempre l'ultima storia inserita prima di questa.
  db.get("SELECT * FROM stories ORDER BY id DESC LIMIT 1", (err, lastStory) => {
    if (err) return res.status(500).json({ error: err.message });

    db.run(
      "INSERT INTO stories(text, kind, photo_code, parent_story_id) VALUES (?, 'original', ?, ?)",
      [text, photoCode, lastStory ? lastStory.id : null],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });

        const participantStoryId = this.lastID;

        if (!lastStory) {
          return res.json({
            participant_story_id: participantStoryId,
            assignment_id: null,
            assigned_story: null
          });
        }

        db.run(
          "INSERT INTO assignments(participant_story_id, assigned_story_id) VALUES (?, ?)",
          [participantStoryId, lastStory.id],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });

            res.json({
              participant_story_id: participantStoryId,
              assignment_id: this.lastID,
              assigned_story: lastStory
            });
          }
        );
      }
    );
  });
});

app.post("/api/continue", (req, res) => {
  const assignmentId = Number(req.body.assignment_id);
  const participantStoryId = Number(req.body.participant_story_id);
  const assignedStoryId = Number(req.body.assigned_story_id);
  const sentence = String(req.body.sentence || "").trim();
  const photoCode = String(req.body.photo_code || "").trim();

  if (!assignmentId || !participantStoryId || !assignedStoryId || !sentence) {
    return res.status(400).json({ error: "Dati mancanti." });
  }

  db.run(
    "INSERT INTO stories(text, kind, photo_code, parent_story_id) VALUES (?, 'continuation', ?, ?)",
    [sentence, photoCode, assignedStoryId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const continuationStoryId = this.lastID;

      db.run(
        `INSERT INTO continuations(
          assignment_id,
          participant_story_id,
          assigned_story_id,
          continuation_story_id,
          sentence,
          photo_code
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [assignmentId, participantStoryId, assignedStoryId, continuationStoryId, sentence, photoCode],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });

          res.json({
            ok: true,
            continuation_id: this.lastID,
            continuation_story_id: continuationStoryId,
            edge: {
              from_story_id: assignedStoryId,
              to_story_id: continuationStoryId
            }
          });
        }
      );
    }
  );
});

app.get("/api/export", (req, res) => {
  db.all("SELECT * FROM stories ORDER BY id", (err, stories) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all("SELECT * FROM assignments ORDER BY id", (err, assignments) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all("SELECT * FROM continuations ORDER BY id", (err, continuations) => {
        if (err) return res.status(500).json({ error: err.message });

        const storyById = new Map(stories.map(story => [story.id, story]));

        const edges = stories
          .filter(story => story.parent_story_id)
          .map(story => ({
            from_story_id: story.parent_story_id,
            to_story_id: story.id,
            to_story_kind: story.kind,
            to_story_photo_code: story.photo_code,
            label: "linked_to_previous_story"
          }));

        const assignment_edges = assignments.map(a => ({
          assignment_id: a.id,
          from_story_id: a.assigned_story_id,
          to_story_id: a.participant_story_id,
          assigned_story_photo_code: storyById.get(a.assigned_story_id)?.photo_code || null,
          participant_story_photo_code: storyById.get(a.participant_story_id)?.photo_code || null,
          label: "assigned_as_previous_story"
        }));

        res.json({
          stories,
          assignments,
          continuations,
          edges,
          assignment_edges
        });
      });
    });
  });
});

app.get("/api/export.csv", (req, res) => {
  db.all(
    `SELECT
      c.id AS continuation_id,
      c.assignment_id,
      c.participant_story_id,
      ps.photo_code AS participant_photo_code,
      ps.text AS participant_story_text,
      c.assigned_story_id,
      ass.photo_code AS assigned_photo_code,
      ass.text AS assigned_story_text,
      c.continuation_story_id,
      cs.photo_code AS continuation_photo_code,
      c.sentence AS continuation_text,
      c.created_at
    FROM continuations c
    JOIN stories ps ON ps.id = c.participant_story_id
    JOIN stories ass ON ass.id = c.assigned_story_id
    LEFT JOIN stories cs ON cs.id = c.continuation_story_id
    ORDER BY c.id`,
    (err, rows) => {
      if (err) return res.status(500).send(err.message);

      const headers = [
        "continuation_id",
        "assignment_id",
        "participant_story_id",
        "participant_photo_code",
        "participant_story_text",
        "assigned_story_id",
        "assigned_photo_code",
        "assigned_story_text",
        "continuation_story_id",
        "continuation_photo_code",
        "continuation_text",
        "created_at"
      ];

      const escapeCsv = value => {
        const s = String(value ?? "");
        return `"${s.replace(/"/g, '""')}"`;
      };

      const csv = [
        headers.join(","),
        ...rows.map(row => headers.map(h => escapeCsv(row[h])).join(","))
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=storie-export.csv");
      res.send(csv);
    }
  );
});

app.get("/api/chain", (req, res) => {
  db.all(
    `SELECT 
      id,
      text,
      kind,
      photo_code,
      parent_story_id,
      created_at
    FROM stories
    ORDER BY id ASC`,
    (err, stories) => {
      if (err) return res.status(500).json({ error: err.message });

      res.json({
        stories,
        continuous_text: stories
          .map(story => story.text)
          .join("\n\n↓\n\n")
      });
    }
  );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Sito attivo sulla porta ${PORT}`);
  console.log(`Export JSON: /api/export`);
  console.log(`Export CSV:  /api/export.csv`);
});
