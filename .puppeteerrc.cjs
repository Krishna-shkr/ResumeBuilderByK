// Store Chromium inside the project so it persists from build → runtime on Render
// (the default ~/.cache/puppeteer is wiped between Render's build and run steps).
const { join } = require('path');
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
