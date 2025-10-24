const API_KEY = "demo-key-123"; // In production, this should come from env

export function getApiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
  };
}

export function getApiKey(): string {
  return API_KEY;
}
