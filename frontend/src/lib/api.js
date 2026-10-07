// Falls back to the current origin when the frontend is served by the backend host
const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/\/+$/, "");
const API_URL = `${BACKEND_URL}/api`;
const REQUEST_TIMEOUT_MS = 15000;

// Small fetch wrapper. Resolves to { status, data }, and rejects with an error that has
// `response: { status, data }` when the server answered with an error status
// (no `response` means the request never got an answer: offline, timeout, ...)
const request = async (method, path, { params, body } = {}) => {
  let url = `${API_URL}${path}`;
  if (params) url += `?${new URLSearchParams(params)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      // Not JSON (e.g. an error page from a proxy)
    }
    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`);
      error.response = { status: response.status, data };
      throw error;
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
};

export const api = {
  get: (path, options) => request("GET", path, options),
  post: (path, body) => request("POST", path, { body })
};

// Derive WebSocket URL from backend URL
export const getWebSocketUrl = (roomCode) => {
  const wsProtocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
  const wsHost = BACKEND_URL.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}/ws/${roomCode}`;
};
