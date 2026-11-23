/** Convert a uint32 (as sent by the backend) to dotted-quad IPv4. */
export function ipv4FromU32(n: number): string {
  const u = n >>> 0
  return [u >>> 24, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join('.')
}
