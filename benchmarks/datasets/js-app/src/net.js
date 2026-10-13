const https = require('https');
function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => resolve(res.statusCode)).on('error', reject);
  });
}
module.exports = { fetchStatus };
