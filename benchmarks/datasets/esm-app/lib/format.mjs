export const VERSION = '2.1.0';

export function formatReport(client, raw, version) {
  return `${client.url} ${version} ${raw.length}`;
}

export default formatReport;
