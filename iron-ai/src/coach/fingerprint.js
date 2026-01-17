function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function hashStringFNV1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashStringSha256(input) {
  if (typeof TextEncoder === "undefined") return null;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export async function buildContextFingerprint(snapshot, contextBytesOverride) {
  const payload = safeStringify(snapshot);
  const contextBytes = Number.isFinite(contextBytesOverride)
    ? contextBytesOverride
    : payload.length;

  let algorithm = "fnv1a32";
  let hash = hashStringFNV1a(payload);

  if (globalThis.crypto?.subtle?.digest) {
    try {
      const sha = await hashStringSha256(payload);
      if (sha) {
        algorithm = "sha256";
        hash = sha.slice(0, 12);
      }
    } catch {
      // Fall back to stable checksum on digest failures.
    }
  }

  return { algorithm, hash, contextBytes };
}
