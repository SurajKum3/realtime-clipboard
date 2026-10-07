import { useState, useRef, useCallback, useEffect } from "react";
import { api, getWebSocketUrl } from "@/lib/api";

const SEND_DEBOUNCE_MS = 100; // Smooth typing without a message per keystroke
const PING_INTERVAL_MS = 25000;
const CONNECT_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 2000;
const HTTP_RETRY_MS = 2000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const WS_ROOM_NOT_FOUND = 4404;

const clearTimer = (timersRef, name) => {
  clearTimeout(timersRef.current[name]);
  clearInterval(timersRef.current[name]);
  timersRef.current[name] = null;
};

const stopPolling = (pollRef, timersRef) => {
  pollRef.current.active = false;
  pollRef.current.run++;
  clearTimer(timersRef, "poll");
};

/**
 * Keeps one clipboard room in sync with the server.
 *
 * WebSocket is the primary transport. While it is down, HTTP polling takes over and the
 * socket keeps reconnecting in the background - the two never run at the same time.
 *
 * Every content change on the server has an increasing version. Remote content is only
 * applied when it is newer than what we have AND we have no local edits waiting to be
 * confirmed, so the server can never overwrite what the user is typing with older text.
 *
 * callbacks: onRemoteContent(content, contentType) - called right before remote content is applied
 *            onRoomGone() - the room expired or no longer exists
 *            onSendError(message) - the server rejected a change
 */
export function useClipboardRoom(callbacks) {
  const [roomCode, setRoomCode] = useState("");
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("text"); // "text" | "image"
  const [status, setStatus] = useState("idle"); // "idle" | "connecting" | "live" | "polling" | "offline"
  const [clientCount, setClientCount] = useState(0);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const roomRef = useRef("");
  const wsRef = useRef(null);
  const versionRef = useRef(-1);
  // Local edit not yet confirmed by the server: { content, contentType, sent, seq }
  const localRef = useRef(null);
  // Newest remote content that arrived while a local edit was unconfirmed
  const deferredRef = useRef(null);
  const seqRef = useRef(0);
  const httpInflightRef = useRef(false);
  const pollRef = useRef({ active: false, run: 0 });
  const reconnectAttemptsRef = useRef(0);
  const timersRef = useRef({});
  // Lets functions defined earlier call ones defined later
  const actionsRef = useRef({});

  const applyRemote = useCallback((remote) => {
    versionRef.current = remote.version;
    const nextContent = remote.content || "";
    const nextType = remote.content_type || "text";
    callbacksRef.current?.onRemoteContent?.(nextContent, nextType);
    setContent(nextContent);
    setContentType(nextType);
  }, []);

  const handleRemote = useCallback((remote) => {
    if (typeof remote.version !== "number" || remote.version <= versionRef.current) return;
    if (localRef.current) {
      // Our own edit is on its way and may be newer - decide once the server confirms it
      if (!deferredRef.current || remote.version > deferredRef.current.version) {
        deferredRef.current = remote;
      }
      return;
    }
    applyRemote(remote);
  }, [applyRemote]);

  const handleAck = useCallback((seq, version) => {
    const local = localRef.current;
    if (!local || !local.sent || local.seq !== seq) {
      // Confirms an edit the user has already typed over
      if (version > versionRef.current) versionRef.current = version;
      return;
    }
    localRef.current = null;
    const deferred = deferredRef.current;
    deferredRef.current = null;
    if (deferred && deferred.version > version) {
      // Someone else's change landed after ours
      applyRemote(deferred);
    } else if (version > versionRef.current) {
      versionRef.current = version;
    }
  }, [applyRemote]);

  const leave = useCallback(() => {
    roomRef.current = "";
    Object.keys(timersRef.current).forEach((name) => clearTimer(timersRef, name));
    stopPolling(pollRef, timersRef);
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) ws.close();
    localRef.current = null;
    deferredRef.current = null;
    httpInflightRef.current = false;
    reconnectAttemptsRef.current = 0;
    versionRef.current = -1;
    setRoomCode("");
    setContent("");
    setContentType("text");
    setClientCount(0);
    setStatus("idle");
  }, []);

  const roomGone = useCallback(() => {
    if (!roomRef.current) return;
    leave();
    callbacksRef.current?.onRoomGone?.();
  }, [leave]);

  // Send the latest local edit to the server
  const flush = useCallback(() => {
    clearTimer(timersRef, "send");
    const local = localRef.current;
    const code = roomRef.current;
    // One request at a time so edits can't arrive out of order (flushed again when it completes)
    if (!local || !code || httpInflightRef.current) return;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      local.sent = true;
      local.seq = ++seqRef.current;
      ws.send(JSON.stringify({
        type: "content_update",
        content: local.content,
        content_type: local.contentType,
        seq: local.seq
      }));
      return;
    }

    // Fallback to HTTP
    httpInflightRef.current = true;
    local.sent = true;
    local.seq = ++seqRef.current;
    const seq = local.seq;

    api.post("/room/content", {
      room_code: code,
      content: local.content,
      content_type: local.contentType
    }).then((response) => {
      if (roomRef.current !== code) return;
      httpInflightRef.current = false;
      handleAck(seq, response.data.version);
      // The user kept typing while the request was in flight
      if (localRef.current) flush();
    }).catch((error) => {
      if (roomRef.current !== code) return;
      httpInflightRef.current = false;
      const httpStatus = error.response?.status;
      if (httpStatus === 404) {
        roomGone();
        return;
      }
      const current = localRef.current;
      if (httpStatus && httpStatus < 500) {
        // Rejected by the server (e.g. too large) - retrying won't help
        if (current && current.seq === seq) {
          localRef.current = null;
          deferredRef.current = null;
        }
        callbacksRef.current?.onSendError?.(error.response?.data?.detail || "Could not sync your change");
        return;
      }
      if (current && current.seq === seq) current.sent = false;
      clearTimer(timersRef, "send");
      timersRef.current.send = setTimeout(flush, HTTP_RETRY_MS);
    });
  }, [handleAck, roomGone]);

  // HTTP polling fallback, only while the WebSocket is down
  const startPolling = useCallback(() => {
    if (pollRef.current.active) return;
    pollRef.current.active = true;
    const run = ++pollRef.current.run;
    const code = roomRef.current;
    const stale = () => roomRef.current !== code || pollRef.current.run !== run;

    const poll = async () => {
      try {
        const response = await api.get(`/room/${code}/content`, { params: { since: versionRef.current } });
        if (stale()) return;
        setStatus("polling");
        if (response.data.changed) handleRemote(response.data);
      } catch (error) {
        if (stale()) return;
        if (error.response?.status === 404) {
          roomGone();
          return;
        }
        setStatus("offline");
      }
      timersRef.current.poll = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timersRef.current.poll = setTimeout(poll, 0);
  }, [handleRemote, roomGone]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    const code = roomRef.current;
    if (!code) return;
    clearTimer(timersRef, "reconnect");

    const previous = wsRef.current;
    if (previous) {
      wsRef.current = null;
      previous.close();
    }

    let ws;
    try {
      ws = new WebSocket(getWebSocketUrl(code));
    } catch (error) {
      startPolling();
      return;
    }
    wsRef.current = ws;

    // Don't wait forever on networks that silently drop WebSockets
    clearTimer(timersRef, "connect");
    timersRef.current.connect = setTimeout(() => ws.close(), CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      clearTimer(timersRef, "connect");
      stopPolling(pollRef, timersRef);
      reconnectAttemptsRef.current = 0;
      setStatus("live");

      clearTimer(timersRef, "ping");
      timersRef.current.ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);

      // Resend anything the server never confirmed
      if (localRef.current) flush();
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (data.type === 'sync') {
        // Current room state, sent when (re)joining
        setClientCount(data.client_count || 1);
        handleRemote(data);
      }
      else if (data.type === 'content_update') {
        // Content updated by another client
        handleRemote(data);
      }
      else if (data.type === 'ack') {
        handleAck(data.seq, data.version);
      }
      else if (data.type === 'client_count') {
        setClientCount(data.count || 1);
      }
      else if (data.type === 'error') {
        const local = localRef.current;
        if (local && local.sent && local.seq === data.seq) {
          localRef.current = null;
          const deferred = deferredRef.current;
          deferredRef.current = null;
          if (deferred) applyRemote(deferred);
        }
        callbacksRef.current?.onSendError?.(data.message || "Could not sync your change");
      }
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      clearTimer(timersRef, "connect");
      clearTimer(timersRef, "ping");

      if (event.code === WS_ROOM_NOT_FOUND) {
        roomGone();
        return;
      }

      // Whatever we sent on this socket may not have arrived - send it again
      if (localRef.current && !httpInflightRef.current) {
        localRef.current.sent = false;
      }

      setStatus((current) => (current === "live" ? "connecting" : current));
      startPolling();
      if (localRef.current) flush();

      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      timersRef.current.reconnect = setTimeout(
        () => actionsRef.current.connect(),
        delay / 2 + Math.random() * delay / 2
      );
    };
  }, [applyRemote, flush, handleAck, handleRemote, roomGone, startPolling]);

  actionsRef.current.connect = connect;

  // Enter a room using the response of /room/join (or an empty object for a new room)
  const enter = useCallback((code, initial = {}) => {
    leave();
    roomRef.current = code;
    versionRef.current = typeof initial.version === "number" ? initial.version : -1;
    setRoomCode(code);
    setContent(initial.content || "");
    setContentType(initial.content_type || "text");
    setClientCount(initial.client_count || 1);
    setStatus("connecting");
    connect();
  }, [connect, leave]);

  // Change the shared content from this device
  const updateContent = useCallback((newContent, newContentType = "text", { immediate = false } = {}) => {
    if (!roomRef.current) return;
    setContent(newContent);
    setContentType(newContentType);
    localRef.current = { content: newContent, contentType: newContentType, sent: false, seq: 0 };

    clearTimer(timersRef, "send");
    if (immediate) {
      flush();
    } else {
      timersRef.current.send = setTimeout(flush, SEND_DEBOUNCE_MS);
    }
  }, [flush]);

  // Reconnect right away when the device comes back online or the tab is shown again
  useEffect(() => {
    const wake = () => {
      if (!roomRef.current || document.visibilityState === "hidden") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        reconnectAttemptsRef.current = 0;
        actionsRef.current.connect();
      }
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => leave, [leave]);

  return { roomCode, content, contentType, status, clientCount, enter, leave, updateContent };
}
