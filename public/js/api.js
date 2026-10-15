// All writes go to the server. The browser never chooses a daily roll or its EP.
let csrf = "";
export function setCsrf(token) {
  csrf = token || "";
}
export async function request(action, data) {
  const startingCsrf = csrf;
  const query = new URLSearchParams({ action });
  const write = data !== undefined;
  const response = await fetch(`/api.php?${query}`, {
    method: write ? "POST" : "GET",
    credentials: "same-origin",
    headers: write
      ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
      : {},
    body: write ? JSON.stringify(data) : undefined,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server could not load your game. Please try again.");
  }
  if (!response.ok || result.error)
    throw new Error(
      result.error ||
        result.message ||
        "Something went wrong. Please try again.",
    );
  // A slow roll response must not restore a token from before a later sign-in.
  if (csrf === startingCsrf) {
    if (result.csrf) setCsrf(result.csrf);
    if (result.state?.csrf) setCsrf(result.state.csrf);
  }
  return result;
}
export async function publicProfile(username) {
  const response = await fetch(
    `/api.php?action=profile&username=${encodeURIComponent(username)}`,
    { credentials: "same-origin" },
  );
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error || "Profile not found.");
  return result;
}
