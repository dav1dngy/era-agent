'use strict';
// Only the main frame of our one application window may use native capabilities.
function trustedSender(event, contents, origin) {
  try {
    return !!contents && event.sender === contents && event.senderFrame === contents.mainFrame && new URL(event.senderFrame.url).origin === origin;
  } catch { return false; }
}
function sameOrigin(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
module.exports = { trustedSender, sameOrigin };
