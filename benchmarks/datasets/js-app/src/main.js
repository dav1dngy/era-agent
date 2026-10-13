const { parseConfig } = require('./config');
const { fetchStatus } = require('./net');

function run(argv) {
  const cfg = parseConfig(argv);
  return fetchStatus(cfg.endpoint).then((s) => console.log('status', s));
}

module.exports = { run };
if (require.main === module) run(process.argv.slice(2));
