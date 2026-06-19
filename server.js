const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'matches.json');
const INITIAL_DATA_PATH = path.join(__dirname, 'data', 'matches.json');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data.json', (req, res) => {
  try {
    const raw = fs.existsSync(DATA_PATH)
      ? fs.readFileSync(DATA_PATH, 'utf8')
      : fs.readFileSync(INITIAL_DATA_PATH, 'utf8');

    const data = JSON.parse(raw);

    // Dynamically mark today on every request so the slider always opens
    // on the current match day without needing to update the data file.
    const now = new Date();
    const todayShort = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let foundToday = false;
    data.days.forEach(d => {
      d.today = (d.short === todayShort);
      if (d.today) foundToday = true;
    });
    // If no match day for today, mark the last known day
    if (!foundToday && data.days.length) {
      data.days[data.days.length - 1].today = true;
    }

    res.json(data);
  } catch (err) {
    console.error('Failed to serve data.json:', err.message);
    res.status(503).json({ error: 'data not available' });
  }
});

app.listen(PORT, () => {
  console.log(`Mundial server running on port ${PORT}`);
});

// NOTE: Match data is refreshed by the "Update match data" GitHub Action
// (.github/workflows/update-data.yml), which runs scripts/update-data.js on a
// schedule and commits data/matches.json back to the repo. The server no longer
// runs the updater in-process: Fly machines have no persistent volume and reset
// their filesystem on restart/redeploy, so in-process writes were silently lost
// (and never ran at all while the machine was auto-stopped). Committing to the
// repo persists the data and triggers a redeploy with the fresh scores.
