// Shared test helper: after any test that edits/tailors the resume, restore the
// pristine seed so the user's real data/resume.json is never left corrupted.
// (Tests hit the SAME data file the app serves — autosave persists their edits.)
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'resume.seed.json'); // seed lives at project root
const DATA_PATH = path.join(__dirname, '..', 'data', 'resume.json');

// Snapshot the current resume before a destructive test, restore it after.
// Prefer resume.seed.json if present; else snapshot whatever is there now.
function installRestore(test) {
  let snapshot = null;
  test.beforeEach(() => {
    if (fs.existsSync(SEED_PATH)) snapshot = fs.readFileSync(SEED_PATH, 'utf8');
    else if (fs.existsSync(DATA_PATH)) snapshot = fs.readFileSync(DATA_PATH, 'utf8');
  });
  test.afterEach(() => {
    if (snapshot) fs.writeFileSync(DATA_PATH, snapshot, 'utf8');
  });
}

module.exports = { installRestore };
