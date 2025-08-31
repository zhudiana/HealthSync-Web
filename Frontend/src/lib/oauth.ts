// src/lib/oauth.ts
function base64UrlEncode(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generatePkce() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const verifier = base64UrlEncode(array.buffer).slice(0, 128); // 43–128
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  const challenge = base64UrlEncode(digest);
  return { verifier, challenge };
}

export function randomState(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toQuery(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

/**
 * Build the OAuth authorization URL for a provider
 */
export function buildAuthUrl(
  provider: "fitbit" | "withings",
  {
    clientId,
    redirectUri,
    scope,
    state,
    challenge,
  }: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    challenge: string;
  }
) {
  if (provider === "fitbit") {
    const base = "https://www.fitbit.com/oauth2/authorize";
    return (
      base +
      "?" +
      toQuery({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
    );
  }

  if (provider === "withings") {
    const base = "https://account.withings.com/oauth2_user/authorize2";
    return (
      base +
      "?" +
      toQuery({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
    );
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
