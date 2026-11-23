// Single source for the backend address used by the live smoke (dev-server proxy and test cleanup).
export const LIVE_API = process.env.ET_LIVE_API ?? 'http://localhost:11211'
