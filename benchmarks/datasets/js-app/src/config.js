const DEFAULT_ENDPOINT = 'https://status.example.test/api/v1/health';
function parseConfig(argv) {
  return { endpoint: argv[0] || DEFAULT_ENDPOINT, verbose: argv.includes('--verbose') };
}
module.exports = { parseConfig, DEFAULT_ENDPOINT };
