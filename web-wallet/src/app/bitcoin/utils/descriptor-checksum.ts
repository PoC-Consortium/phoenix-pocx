// BIP-380 output descriptor checksum (same polymod family as bech32).
// This is a pure function with no Angular or RxJS dependencies, so it can be
// shared between the DescriptorService wallet-generation path and the
// watch-only entry-validation path.

const INPUT_CHARSET =
  '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(c: bigint, val: number): bigint {
  const c0 = c >> BigInt(35);
  c = ((c & BigInt(0x7ffffffff)) << BigInt(5)) ^ BigInt(val);
  if (c0 & BigInt(1)) c ^= BigInt(0xf5dee51989);
  if (c0 & BigInt(2)) c ^= BigInt(0xa9fdca3312);
  if (c0 & BigInt(4)) c ^= BigInt(0x1bab10e32d);
  if (c0 & BigInt(8)) c ^= BigInt(0x3706b1677a);
  if (c0 & BigInt(16)) c ^= BigInt(0x644d626ffd);
  return c;
}

/**
 * Compute the 8-character BIP-380 checksum for a descriptor body (the part
 * before the `#`). Throws on characters outside the descriptor input charset.
 */
export function descriptorChecksum(desc: string): string {
  let c = BigInt(1);
  let cls = 0;
  let clscount = 0;

  for (const ch of desc) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos === -1) {
      throw new Error(`Invalid character in descriptor: ${ch}`);
    }
    c = polymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    clscount++;
    if (clscount === 3) {
      c = polymod(c, cls);
      cls = 0;
      clscount = 0;
    }
  }
  if (clscount > 0) c = polymod(c, cls);
  for (let i = 0; i < 8; i++) c = polymod(c, 0);
  c ^= BigInt(1);

  let result = '';
  for (let i = 0; i < 8; i++) {
    result += CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & BigInt(31))];
  }
  return result;
}
