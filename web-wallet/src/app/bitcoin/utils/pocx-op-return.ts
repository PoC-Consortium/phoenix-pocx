// PoCX assignment / revocation OP_RETURN parsers.
//
// Mirrors the format defined in bitcoin/src/pocx/assignments/opcodes.cpp:
//   Assignment:  OP_RETURN 0x2c "POCX" <plot_20B> <forge_20B>     (46 bytes / 92 hex chars)
//   Revocation:  OP_RETURN 0x18 "XCOP" <plot_20B>                  (26 bytes / 52 hex chars)
//
// Returned hashes are 40-char lowercase hex strings (the raw 20-byte witness v0
// keyhash). Callers convert to a bech32 address via the hex_to_bech32 Tauri
// command using the active network's HRP.

const ASSIGNMENT_MARKER_HEX = '504f4358'; // "POCX"
const REVOCATION_MARKER_HEX = '58434f50'; // "XCOP"

const OP_RETURN = '6a';
const ASSIGNMENT_PUSH_LEN = '2c'; // 44 bytes: 4 marker + 20 plot + 20 forge
const REVOCATION_PUSH_LEN = '18'; // 24 bytes: 4 marker + 20 plot

const ASSIGNMENT_SCRIPT_HEX_LEN = 2 + 2 + 8 + 40 + 40; // = 92
const REVOCATION_SCRIPT_HEX_LEN = 2 + 2 + 8 + 40; // = 52

export interface AssignmentMarker {
  plotHashHex: string;
  forgeHashHex: string;
}

export interface RevocationMarker {
  plotHashHex: string;
}

export function parseAssignmentScript(
  scriptHex: string | undefined | null
): AssignmentMarker | null {
  if (!scriptHex) return null;
  const hex = scriptHex.toLowerCase();
  if (hex.length !== ASSIGNMENT_SCRIPT_HEX_LEN) return null;
  if (!hex.startsWith(OP_RETURN + ASSIGNMENT_PUSH_LEN + ASSIGNMENT_MARKER_HEX)) return null;
  const dataStart = 2 + 2 + 8;
  return {
    plotHashHex: hex.slice(dataStart, dataStart + 40),
    forgeHashHex: hex.slice(dataStart + 40, dataStart + 80),
  };
}

export function parseRevocationScript(
  scriptHex: string | undefined | null
): RevocationMarker | null {
  if (!scriptHex) return null;
  const hex = scriptHex.toLowerCase();
  if (hex.length !== REVOCATION_SCRIPT_HEX_LEN) return null;
  if (!hex.startsWith(OP_RETURN + REVOCATION_PUSH_LEN + REVOCATION_MARKER_HEX)) return null;
  const dataStart = 2 + 2 + 8;
  return {
    plotHashHex: hex.slice(dataStart, dataStart + 40),
  };
}

// Per-network consensus delays from bitcoin/src/kernel/chainparams.cpp
// (nForgingAssignmentDelay / nForgingRevocationDelay). These change only on a
// hard fork — same release cadence as the wallet itself.
const DELAYS: Record<string, { assignment: number; revocation: number }> = {
  mainnet: { assignment: 30, revocation: 720 },
  testnet: { assignment: 30, revocation: 720 },
  regtest: { assignment: 4, revocation: 8 },
};

export function getForgingAssignmentDelay(network: string): number {
  return (DELAYS[network] ?? DELAYS['mainnet']).assignment;
}

export function getForgingRevocationDelay(network: string): number {
  return (DELAYS[network] ?? DELAYS['mainnet']).revocation;
}
