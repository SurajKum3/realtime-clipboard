import { useState, useRef, useCallback, useEffect } from "react";
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
import axios from "axios";
import "@/App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Derive WebSocket URL from backend URL
const getWebSocketUrl = (roomCode) => {
  const wsProtocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
  const wsHost = BACKEND_URL.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}/ws/${roomCode}`;
};

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }
};

const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 }
};

function App() {
  // View state: "home" | "room"
  const [view, setView] = useState("home");
  
  // Room state
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  
  // Clipboard content state
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("text"); // "text" | "image"
  const [imagePreview, setImagePreview] = useState("");
  
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  
  // Refs
  const wsRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const syncTimeoutRef = useRef(null);
  const lastContentRef = useRef("");
  
  // Calculate line count
  const lineCount = content.split('\n').length;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, []);

  // HTTP Polling fallback for when WebSocket fails
  const startPolling = useCallback((code) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await axios.post(`${API}/room/join`, { room_code: code });
        const serverContent = response.data.content || "";
        const serverType = response.data.content_type || "text";
        
        // Only update if content changed and wasn't our own update
        if (serverContent !== lastContentRef.current) {
          lastContentRef.current = serverContent;
          setContent(serverContent);
          setContentType(serverType);
          if (serverType === "image") {
            setImagePreview(serverContent);
          }
          setClientCount(response.data.client_count || 1);
        }
      } catch (error) {
        console.log('Polling error:', error.message);
      }
    }, 2000); // Poll every 2 seconds
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connectWebSocket = useCallback((code) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    setIsConnecting(true);
    setIsConnected(false);
    
    const wsUrl = getWebSocketUrl(code);
    console.log('Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setIsConnecting(false);
      
      // Start ping interval
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
      
      toast.success("Connected to clipboard room!", {
        icon: <Wifi size={16} />,
        duration: 2000
      });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data.type);
        
        if (data.type === 'sync') {
          // Initial sync when joining
          setContent(data.content || "");
          setContentType(data.content_type || "text");
          if (data.content_type === "image") {
            setImagePreview(data.content || "");
          }
          setClientCount(data.client_count || 1);
        }
        else if (data.type === 'content_update') {
          // Content updated by another client
          setContent(data.content || "");
          setContentType(data.content_type || "text");
          if (data.content_type === "image") {
            setImagePreview(data.content || "");
          }
        }
        else if (data.type === 'client_count') {
          setClientCount(data.count || 1);
        }
        else if (data.type === 'pong') {
          console.log('Ping successful');
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnecting(false);
      // Start HTTP polling as fallback
      startPolling(code);
      setIsConnected(true); // Mark as connected via polling
      toast.info("Using sync fallback mode", { duration: 2000 });
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setIsConnecting(false);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      // Start polling if we're still in the room
      if (view === "room" && roomCode) {
        startPolling(roomCode);
        setIsConnected(true);
      }
    };
  }, [startPolling, view, roomCode]);

  // Disconnect WebSocket
  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    stopPolling();
    setIsConnected(false);
    setIsConnecting(false);
  }, [stopPolling]);

  // Send content update via WebSocket
  const sendContentUpdate = useCallback((newContent, newContentType = "text") => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: newContentType === "image" ? "image_update" : "content_update",
        content: newContent,
        content_type: newContentType
      }));
    } else {
      // Fallback to HTTP
      axios.post(`${API}/room/content`, {
        room_code: roomCode,
        content: newContent,
        content_type: newContentType
      }).catch(err => console.error('HTTP fallback error:', err));
    }
  }, [roomCode]);

  // Handle text change with debounced sync
  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setContent(newContent);
    setContentType("text");
    lastContentRef.current = newContent; // Track our own changes
    
    // Debounce WebSocket updates
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      sendContentUpdate(newContent, "text");
    }, 100); // 100ms debounce for smooth typing
  };

  // Create new room
  const handleCreateRoom = async () => {
    setIsCreating(true);
    try {
      const response = await axios.post(`${API}/room/create`);
      const code = response.data.room_code;
      setRoomCode(code);
      setView("room");
      setContent("");
      setContentType("text");
      setImagePreview("");
      setClientCount(1); // Current user
      connectWebSocket(code);
      toast.success(`Room ${code} created!`);
    } catch (error) {
      console.error("Error creating room:", error);
      toast.error("Failed to create room. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  // Join existing room
  const handleJoinRoom = async () => {
    if (!joinCode.trim() || joinCode.length < 6) {
      toast.error("Please enter a valid 6-character room code");
      return;
    }

    setIsJoining(true);
    try {
      const response = await axios.post(`${API}/room/join`, {
        room_code: joinCode.toUpperCase()
      });
      
      const code = response.data.room_code;
      setRoomCode(code);
      setContent(response.data.content || "");
      setContentType(response.data.content_type || "text");
      if (response.data.content_type === "image") {
        setImagePreview(response.data.content || "");
      }
      setClientCount(response.data.client_count || 1);
      setView("room");
      connectWebSocket(code);
      toast.success(`Joined room ${code}!`);
    } catch (error) {
      console.error("Error joining room:", error);
      const message = error.response?.data?.detail || "Room not found or expired";
      toast.error(message);
    } finally {
      setIsJoining(false);
    }
  };

  // Leave room
  const handleLeaveRoom = () => {
    disconnectWebSocket();
    setView("home");
    setRoomCode("");
    setContent("");
    setContentType("text");
    setImagePreview("");
    setJoinCode("");
    setClientCount(0);
    toast.info("Left the room");
  };

  // Copy room code
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCodeCopied(true);
      toast.success("Room code copied!");
      setTimeout(() => setCodeCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy code");
    }
  };

  // Copy clipboard content
  const handleCopyContent = async () => {
    if (contentType === "text" && content) {
      try {
        await navigator.clipboard.writeText(content);
        toast.success("Content copied to clipboard!");
      } catch (error) {
        toast.error("Failed to copy content");
      }
    }
  };

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setImagePreview(dataUrl);
      setContent(dataUrl);
      setContentType("image");
      sendContentUpdate(dataUrl, "image");
      toast.success("Image shared!");
    };
    reader.readAsDataURL(file);
  };

  // Handle drag and drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image size must be less than 5MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        setImagePreview(dataUrl);
        setContent(dataUrl);
        setContentType("image");
        sendContentUpdate(dataUrl, "image");
        toast.success("Image shared!");
      };
      reader.readAsDataURL(file);
    }
  }, [sendContentUpdate]);

  // Clear image and switch to text
  const handleClearImage = () => {
    setImagePreview("");
    setContent("");
    setContentType("text");
    sendContentUpdate("", "text");
  };

  // Download image
  const handleDownloadImage = () => {
    if (imagePreview) {
      const link = document.createElement('a');
      link.href = imagePreview;
      link.download = `onboard-${roomCode}.png`;
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
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                maxLength={6}
                data-testid="join-code-input"
              />
              <motion.button
                className="btn-secondary-full"
                onClick={handleJoinRoom}
                disabled={isJoining || joinCode.length < 6}
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
              <div className={`status-badge ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
                {isConnected ? <Wifi size={14} /> : isConnecting ? <Wifi size={14} className="pulse" /> : <WifiOff size={14} />}
                {isConnected ? 'Live' : isConnecting ? 'Connecting...' : 'Disconnected'}
              </div>
              <div className="client-count" data-testid="client-count">
                <Users size={14} />
                {clientCount} {clientCount === 1 ? 'user' : 'users'}
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
              className={`mode-btn ${contentType === 'text' ? 'active' : ''}`}
              onClick={() => {
                if (contentType !== 'text') {
                  setContentType('text');
                  setImagePreview('');
                }
              }}
              data-testid="text-mode-btn"
            >
              <Clipboard size={18} />
              Text
            </button>
            <button 
              className={`mode-btn ${contentType === 'image' ? 'active' : ''}`}
              onClick={() => {
                setContentType('image');
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
          {contentType === 'text' ? (
            <div className="text-area-wrapper"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <textarea
                className="clipboard-textarea"
                placeholder="Paste or type anything here... Content syncs in realtime across all connected devices."
                value={content}
                onChange={handleContentChange}
                data-testid="clipboard-textarea"
              />
              <div className="textarea-footer">
                <span className="line-count">{lineCount.toLocaleString()} lines</span>
                <button 
                  className="copy-content-btn"
                  onClick={handleCopyContent}
                  disabled={!content}
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
            <div className={`sync-dot ${isConnected ? 'active' : ''}`} />
            <span>{isConnected ? 'Changes sync instantly across all devices' : 'Reconnecting...'}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default App;
