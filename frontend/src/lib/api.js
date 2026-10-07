import axios from "axios";

// Falls back to the current origin when the frontend is served by the backend host
const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/\/+$/, "");

export const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 15000
});

// Derive WebSocket URL from backend URL
export const getWebSocketUrl = (roomCode) => {
  const wsProtocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
  const wsHost = BACKEND_URL.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}/ws/${roomCode}`;
};
