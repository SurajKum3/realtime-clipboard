import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "react-qr-code";
import { Toaster, toast } from "sonner";
import {
  Clipboard,
  Image,
  Upload,
  Copy,
  Check,
  QrCode,
  Users,
  Wifi,
  WifiOff,
  Plus,
  LogIn,
  X,
  Zap,
  ArrowLeft,
  Download
} from "lucide-react";
import { api } from "@/lib/api";
import { useClipboardRoom } from "@/hooks/useClipboardRoom";
import "@/App.css";

const ROOM_CODE_LENGTH = 6;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const cleanRoomCode = (value) =>
  (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH);

// Animation variants
const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 }
};

// navigator.clipboard only exists on HTTPS/localhost, so fall back to the legacy copy command
const copyText = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(helper);
  if (!copied) throw new Error("Copy failed");
};

// Where a caret at `position` in oldText should sit after the text becomes newText
const shiftCaret = (position, oldText, newText) => {
  const maxCommon = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxCommon && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < maxCommon - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix++;

  if (position <= prefix) return position;
  if (position >= oldText.length - suffix) return position + newText.length - oldText.length;
  return newText.length - suffix;
};

const setRoomInUrl = (code) => {
  const url = code ? `${window.location.pathname}?join=${code}` : window.location.pathname;
  window.history.replaceState(null, "", url);
};

function App() {
  // Room state
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  // Which tab is shown: "text" | "image" (follows the shared content when it changes)
  const [mode, setMode] = useState("text");
  const [codeCopied, setCodeCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Refs
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingSelectionRef = useRef(null);
  const autoJoinedRef = useRef(false);

  const resetRoomUi = () => {
    setRoomInUrl("");
    setMode("text");
    setShowQR(false);
    setJoinCode("");
    pendingSelectionRef.current = null;
  };

  // Realtime sync for the current room (content, connection state, user count)
  const room = useClipboardRoom({
    onRemoteContent: (nextContent, nextType) => {
      setMode(nextType);
      // Keep the caret where the user left it when someone else edits the text
      const textarea = textareaRef.current;
      if (nextType === "text" && textarea && document.activeElement === textarea && textarea.value !== nextContent) {
        pendingSelectionRef.current = {
          start: shiftCaret(textarea.selectionStart, textarea.value, nextContent),
          end: shiftCaret(textarea.selectionEnd, textarea.value, nextContent)
        };
      }
    },
    onRoomGone: () => {
      resetRoomUi();
      toast.error("This room has expired or no longer exists");
    },
    onSendError: (message) => toast.error(message)
  });

  const { roomCode, content, contentType, status, clientCount } = room;
  const view = roomCode ? "room" : "home";
  const text = contentType === "text" ? content : "";
  const imagePreview = contentType === "image" ? content : "";
  const isLive = status === "live" || status === "polling";
  const isConnecting = status === "connecting";

  // Calculate line count
  const lineCount = text.split('\n').length;

  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current;
    if (selection && textareaRef.current) {
      textareaRef.current.setSelectionRange(selection.start, selection.end);
    }
    pendingSelectionRef.current = null;
  }, [content]);

  // Handle text change (synced by the room hook with a short debounce)
  const handleContentChange = (e) => {
    pendingSelectionRef.current = null;
    room.updateContent(e.target.value, "text");
  };

  // Create new room
  const handleCreateRoom = async () => {
    setIsCreating(true);
    try {
      const response = await api.post("/room/create");
      const code = response.data.room_code;
      setMode("text");
      room.enter(code);
      setRoomInUrl(code);
      toast.success(`Room ${code} created!`);
    } catch (error) {
      console.error("Error creating room:", error);
      toast.error("Failed to create room. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  // Join existing room
  const joinRoom = async (rawCode) => {
    const code = cleanRoomCode(rawCode);
    if (code.length < ROOM_CODE_LENGTH) {
      toast.error("Please enter a valid 6-character room code");
      return;
    }

    setIsJoining(true);
    try {
      const response = await api.post("/room/join", { room_code: code });
      setMode(response.data.content_type || "text");
      room.enter(response.data.room_code, response.data);
      setRoomInUrl(response.data.room_code);
      toast.success(`Joined room ${response.data.room_code}!`);
    } catch (error) {
      console.error("Error joining room:", error);
      const message = error.response?.data?.detail || "Could not join the room. Please try again.";
      setRoomInUrl("");
      toast.error(message);
    } finally {
      setIsJoining(false);
    }
  };

  const handleJoinRoom = () => joinRoom(joinCode);

  // Join straight from a shared link / QR code (?join=CODE). Also restores the room on refresh
  useEffect(() => {
    if (autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    const code = cleanRoomCode(new URLSearchParams(window.location.search).get("join"));
    if (code.length === ROOM_CODE_LENGTH) {
      setJoinCode(code);
      joinRoom(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leave room
  const handleLeaveRoom = () => {
    room.leave();
    resetRoomUi();
    toast.info("Left the room");
  };

  // Copy room code
  const handleCopyCode = async () => {
    try {
      await copyText(roomCode);
      setCodeCopied(true);
      toast.success("Room code copied!");
      setTimeout(() => setCodeCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy code");
    }
  };

  // Copy clipboard content
  const handleCopyContent = async () => {
    if (text) {
      try {
        await copyText(text);
        toast.success("Content copied to clipboard!");
      } catch (error) {
        toast.error("Failed to copy content");
      }
    }
  };

  // Share an image file with the room
  const shareImage = (file) => {
    if (!file.type.startsWith('image/')) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Image size must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setMode("image");
      room.updateContent(reader.result, "image", { immediate: true });
      toast.success("Image shared!");
    };
    reader.onerror = () => toast.error("Could not read that image");
    reader.readAsDataURL(file);
  };
  const shareImageRef = useRef(shareImage);
  shareImageRef.current = shareImage;

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    // Allow picking the same file again later
    e.target.value = "";
    if (file) shareImage(file);
  };

  // Handle drag and drop
  const handleDrop = (e) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    shareImage(file);
  };

  // Paste an image (e.g. a screenshot) anywhere in the room to share it
  useEffect(() => {
    if (view !== "room") return;
    const handlePaste = (e) => {
      const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      shareImageRef.current(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [view]);

  // Clear image and switch to text
  const handleClearImage = () => {
    setMode("text");
    room.updateContent("", "text", { immediate: true });
  };

  // Download image
  const handleDownloadImage = () => {
    if (imagePreview) {
      const extension = (imagePreview.match(/^data:image\/([a-z0-9]+)/i)?.[1] || "png").replace("jpeg", "jpg");
      const link = document.createElement('a');
      link.href = imagePreview;
      link.download = `onboard-${roomCode}.${extension}`;
      link.click();
      toast.success("Image downloaded!");
    }
  };

  // Render Home View
  if (view === "home") {
    return (
      <div className="onboard-app">
        <Toaster position="top-center" richColors />
        <div className="hero-bg" />
        
        <div className="main-content">
          {/* Header */}
          <motion.header 
            className="header"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="logo" data-testid="logo">
              <span className="logo-dot" />
              OnBoard.in
            </div>
          </motion.header>

          {/* Hero Section */}
          <motion.section 
            className="hero-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h1 className="hero-title gradient-text" data-testid="hero-title">
              Realtime Clipboard
            </h1>
            <p className="hero-subtitle">
              Create a room, share the code, and sync your clipboard in realtime across devices.
            </p>
          </motion.section>

          {/* Action Cards */}
          <div className="action-cards">
            {/* Create Room Card */}
            <motion.div
              className="action-card"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              data-testid="create-room-card"
            >
              <div className="action-icon create">
                <Plus size={28} />
              </div>
              <h2 className="action-title">Create Clipboard</h2>
              <p className="action-desc">
                Start a new realtime clipboard room and share the code with others
              </p>
              <motion.button
                className="btn-primary"
                onClick={handleCreateRoom}
                disabled={isCreating}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                data-testid="create-room-btn"
              >
                {isCreating ? (
                  <>
                    <div className="spinner" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    Create Clipboard
                  </>
                )}
              </motion.button>
            </motion.div>

            {/* Join Room Card */}
            <motion.div
              className="action-card"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              data-testid="join-room-card"
            >
              <div className="action-icon join">
                <LogIn size={28} />
              </div>
              <h2 className="action-title">Join Clipboard</h2>
              <p className="action-desc">
                Enter a room code to join an existing clipboard session
              </p>
              <input
                type="text"
                className="code-input"
                placeholder="XXXXXX"
                value={joinCode}
                onChange={(e) => setJoinCode(cleanRoomCode(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isJoining) handleJoinRoom();
                }}
                maxLength={ROOM_CODE_LENGTH}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                data-testid="join-code-input"
              />
              <motion.button
                className="btn-secondary-full"
                onClick={handleJoinRoom}
                disabled={isJoining || joinCode.length < ROOM_CODE_LENGTH}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                data-testid="join-room-btn"
              >
                {isJoining ? (
                  <>
                    <div className="spinner dark" />
                    Joining...
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    Join Room
                  </>
                )}
              </motion.button>
            </motion.div>
          </div>

          {/* Footer */}
          <motion.footer
            className="footer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <div className="footer-content">
              <p className="footer-brand">OnBoard.in</p>
              <p className="footer-tagline">Realtime Clipboard Sharing</p>
            </div>
          </motion.footer>
        </div>
      </div>
    );
  }

  // Render Room View
  return (
    <div className="onboard-app">
      <Toaster position="top-center" richColors />
      <div className="hero-bg" />
      
      <div className="main-content">
        {/* Room Header */}
        <motion.header 
          className="room-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <button 
            className="back-btn"
            onClick={handleLeaveRoom}
            data-testid="leave-room-btn"
          >
            <ArrowLeft size={20} />
            Leave
          </button>
          
          <div className="room-info">
            <div className="room-code-display" data-testid="room-code-display">
              <span className="room-label">Room</span>
              <span className="room-code">{roomCode}</span>
              <button 
                className="copy-btn"
                onClick={handleCopyCode}
                data-testid="copy-room-code-btn"
              >
                {codeCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button 
                className="qr-btn"
                onClick={() => setShowQR(!showQR)}
                data-testid="toggle-qr-btn"
              >
                <QrCode size={16} />
              </button>
            </div>
            
            <div className="connection-info">
              <div className={`status-badge ${isLive ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`} data-testid="connection-status">
                {isLive ? <Wifi size={14} /> : isConnecting ? <Wifi size={14} className="pulse" /> : <WifiOff size={14} />}
                {isLive ? 'Live' : isConnecting ? 'Connecting...' : 'Offline'}
              </div>
              <div className="client-count" data-testid="client-count">
                <Users size={14} />
                {Math.max(clientCount, 1)} {clientCount <= 1 ? 'user' : 'users'}
              </div>
            </div>
          </div>
        </motion.header>

        {/* QR Code Popup */}
        <AnimatePresence>
          {showQR && (
            <motion.div
              className="qr-popup"
              variants={scaleIn}
              initial="initial"
              animate="animate"
              exit="exit"
              data-testid="qr-popup"
            >
              <div className="qr-popup-content">
                <button className="qr-close" onClick={() => setShowQR(false)}>
                  <X size={20} />
                </button>
                <p className="qr-label">Scan to join room</p>
                <div className="qr-code-wrapper">
                  <QRCode value={`${window.location.origin}?join=${roomCode}`} size={180} level="M" />
                </div>
                <p className="qr-code-text">{roomCode}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clipboard Area */}
        <motion.div
          className="clipboard-room"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          data-testid="clipboard-room"
        >
          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button 
              className={`mode-btn ${mode === 'text' ? 'active' : ''}`}
              onClick={() => setMode('text')}
              data-testid="text-mode-btn"
            >
              <Clipboard size={18} />
              Text
            </button>
            <button 
              className={`mode-btn ${mode === 'image' ? 'active' : ''}`}
              onClick={() => {
                setMode('image');
                if (!imagePreview) {
                  fileInputRef.current?.click();
                }
              }}
              data-testid="image-mode-btn"
            >
              <Image size={18} />
              Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
              data-testid="image-upload-input"
            />
          </div>

          {/* Content Area */}
          {mode === 'text' ? (
            <div className="text-area-wrapper"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <textarea
                ref={textareaRef}
                className="clipboard-textarea"
                placeholder="Paste or type anything here... Content syncs in realtime across all connected devices."
                value={text}
                onChange={handleContentChange}
                data-testid="clipboard-textarea"
              />
              <div className="textarea-footer">
                <span className="line-count">{lineCount.toLocaleString()} lines</span>
                <button 
                  className="copy-content-btn"
                  onClick={handleCopyContent}
                  disabled={!text}
                  data-testid="copy-content-btn"
                >
                  <Copy size={14} />
                  Copy
                </button>
              </div>
            </div>
          ) : (
            <div className="image-area">
              {imagePreview ? (
                <div className="image-display" data-testid="image-display">
                  <img src={imagePreview} alt="Shared content" />
                  <div className="image-actions">
                    <button className="btn-secondary" onClick={handleDownloadImage}>
                      <Download size={16} />
                      Download
                    </button>
                    <button className="btn-secondary" onClick={handleClearImage}>
                      <X size={16} />
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <div 
                  className="drop-zone"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  data-testid="image-drop-zone"
                >
                  <Upload size={48} className="drop-icon" />
                  <p className="drop-text">Drop an image here or click to upload</p>
                  <p className="drop-hint">Supports JPEG, PNG, GIF, WebP (max 5MB)</p>
                </div>
              )}
            </div>
          )}

          {/* Sync Indicator */}
          <div className="sync-indicator" data-testid="sync-indicator">
            <div className={`sync-dot ${isLive ? 'active' : ''}`} />
            <span>{isLive ? 'Changes sync across all devices' : isConnecting ? 'Connecting...' : 'Offline - your changes will sync when you reconnect'}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default App;
