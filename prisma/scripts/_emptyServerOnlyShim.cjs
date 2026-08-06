// prisma/scripts/_emptyServerOnlyShim.cjs
// Target of _serverOnlyCjsHook.cjs — mirrors the real server-only/client-only
// packages' no-op export shape (they only throw inside a browser bundle).
module.exports = {}
