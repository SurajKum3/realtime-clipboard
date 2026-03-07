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
  Send,
  Download,
  Clock,
  Zap,
  X
} from "lucide-react";
import axios from "axios";
import "@/App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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
  // Text clipboard state
  const [text, setText] = useState("");
  const [textCode, setTextCode] = useState("");
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [showTextQR, setShowTextQR] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [textExpiry, setTextExpiry] = useState(null);

  // Image clipboard state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageCode, setImageCode] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [showImageQR, setShowImageQR] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const [imageExpiry, setImageExpiry] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Receiver state
  const [receiveCode, setReceiveCode] = useState("");
  const [receivedContent, setReceivedContent] = useState(null);
  const [isReceiving, setIsReceiving] = useState(false);

  const fileInputRef = useRef(null);

  // Calculate line count
  const lineCount = text.split('\n').length;
  const maxLines = 5000;

  // Timer effect for expiration countdown
  useEffect(() => {
    const interval = setInterval(() => {
      if (textExpiry) {
        const remaining = new Date(textExpiry) - new Date();
        if (remaining <= 0) {
          setTextCode("");
          setTextExpiry(null);
          toast.info("Text share code expired");
        }
      }
      if (imageExpiry) {
        const remaining = new Date(imageExpiry) - new Date();
        if (remaining <= 0) {
          setImageCode("");
          setImageExpiry(null);
          toast.info("Image share code expired");
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [textExpiry, imageExpiry]);

  // Format remaining time
  const formatTimeRemaining = (expiryDate) => {
    if (!expiryDate) return "";
    const remaining = new Date(expiryDate) - new Date();
    if (remaining <= 0) return "Expired";
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Generate text share code
  const handleGenerateTextCode = async () => {
    if (!text.trim()) {
      toast.error("Please enter some text first");
      return;
    }

    setIsGeneratingText(true);
    try {
      const response = await axios.post(`${API}/clipboard`, {
        content: text,
        content_type: "text"
      });
      setTextCode(response.data.code);
      setTextExpiry(response.data.expires_at);
      toast.success("Share code generated!");
    } catch (error) {
      console.error("Error generating code:", error);
      toast.error("Failed to generate code. Please try again.");
    } finally {
      setIsGeneratingText(false);
    }
  };

  // Copy text code to clipboard
  const handleCopyTextCode = async () => {
    try {
      await navigator.clipboard.writeText(textCode);
      setTextCopied(true);
      toast.success("Code copied to clipboard!");
      setTimeout(() => setTextCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy code");
    }
  };

  // Handle image drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    } else {
      toast.error("Please drop an image file");
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // Handle file input
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // Clear image
  const handleClearImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageCode("");
    setImageExpiry(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Generate image share code
  const handleGenerateImageCode = async () => {
    if (!imageFile) {
      toast.error("Please upload an image first");
      return;
    }

    setIsGeneratingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      
      const response = await axios.post(`${API}/clipboard/image`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setImageCode(response.data.code);
      setImageExpiry(response.data.expires_at);
      toast.success("Image share code generated!");
    } catch (error) {
      console.error("Error generating image code:", error);
      const message = error.response?.data?.detail || "Failed to generate code";
      toast.error(message);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Copy image code
  const handleCopyImageCode = async () => {
    try {
      await navigator.clipboard.writeText(imageCode);
      setImageCopied(true);
      toast.success("Code copied to clipboard!");
      setTimeout(() => setImageCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy code");
    }
  };

  // Receive clipboard content
  const handleReceive = async () => {
    if (!receiveCode.trim()) {
      toast.error("Please enter a share code");
      return;
    }

    setIsReceiving(true);
    setReceivedContent(null);
    
    try {
      const response = await axios.post(`${API}/clipboard/receive`, {
        code: receiveCode.toUpperCase()
      });
      setReceivedContent(response.data);
      toast.success("Content received!");
    } catch (error) {
      console.error("Error receiving content:", error);
      const message = error.response?.data?.detail || "Code not found or expired";
      toast.error(message);
    } finally {
      setIsReceiving(false);
    }
  };

  // Copy received text
  const handleCopyReceivedText = async () => {
    if (receivedContent?.content && receivedContent.content_type === "text") {
      try {
        await navigator.clipboard.writeText(receivedContent.content);
        toast.success("Text copied to clipboard!");
      } catch (error) {
        toast.error("Failed to copy text");
      }
    }
  };

  // Download received image
  const handleDownloadImage = () => {
    if (receivedContent?.content && receivedContent.content_type === "image") {
      const link = document.createElement('a');
      link.href = receivedContent.content;
      link.download = `onboard-image-${receivedContent.code}.png`;
      link.click();
      toast.success("Image downloaded!");
    }
  };

  return (
    <div className="onboard-app">
      <Toaster 
        position="top-center" 
        richColors 
        toastOptions={{
          style: {
            fontFamily: "'Inter', sans-serif",
          }
        }}
      />
      
      {/* Background */}
      <div className="hero-bg" />
      
      <div className="main-content">
        {/* Header */}
        <motion.header 
          className="header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
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
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <h1 className="hero-title gradient-text" data-testid="hero-title">
            Instant Clipboard<br />Between Devices
          </h1>
          <p className="hero-subtitle">
            Share text or images instantly with a simple code. No signup, no friction — just paste and share.
          </p>
        </motion.section>

        {/* Clipboard Container */}
        <div className="clipboard-container">
          {/* Text Clipboard */}
          <motion.div
            className="clipboard-card"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            data-testid="text-clipboard-card"
          >
            <div className="card-header">
              <div className="card-icon">
                <Clipboard size={22} />
              </div>
              <h2 className="card-title">Text Clipboard</h2>
            </div>

            <textarea
              className="text-input"
              placeholder="Paste your text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500000}
              data-testid="text-input"
            />
            
            <div className="line-counter" data-testid="line-counter">
              {lineCount.toLocaleString()} / {maxLines.toLocaleString()} lines
            </div>

            <motion.button
              className="btn-primary"
              onClick={handleGenerateTextCode}
              disabled={isGeneratingText || !text.trim()}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              data-testid="generate-text-code-btn"
            >
              {isGeneratingText ? (
                <>
                  <div className="spinner" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Generate Code
                </>
              )}
            </motion.button>

            <AnimatePresence>
              {textCode && (
                <motion.div
                  className="code-card"
                  variants={scaleIn}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  data-testid="text-code-card"
                >
                  <p className="code-label">Share this code</p>
                  <p className="code-value" data-testid="text-share-code">{textCode}</p>
                  
                  <div className="code-actions">
                    <button
                      className="btn-secondary"
                      onClick={handleCopyTextCode}
                      data-testid="copy-text-code-btn"
                    >
                      {textCopied ? <Check size={16} /> : <Copy size={16} />}
                      {textCopied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowTextQR(!showTextQR)}
                      data-testid="toggle-text-qr-btn"
                    >
                      <QrCode size={16} />
                      {showTextQR ? "Hide QR" : "Show QR"}
                    </button>
                  </div>

                  <AnimatePresence>
                    {showTextQR && (
                      <motion.div
                        className="qr-container"
                        variants={scaleIn}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        data-testid="text-qr-code"
                      >
                        <QRCode value={textCode} size={120} level="M" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {textExpiry && (
                    <div className="expiration-timer" data-testid="text-expiry-timer">
                      <Clock size={14} />
                      Expires in {formatTimeRemaining(textExpiry)}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Image Clipboard */}
          <motion.div
            className="clipboard-card"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            data-testid="image-clipboard-card"
          >
            <div className="card-header">
              <div className="card-icon">
                <Image size={22} />
              </div>
              <h2 className="card-title">Image Clipboard</h2>
            </div>

            {!imagePreview ? (
              <div
                className={`drop-zone ${isDragOver ? 'active' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                data-testid="image-drop-zone"
              >
                <Upload className="drop-zone-icon" />
                <p className="drop-zone-text">
                  Drag & drop an image here, or click to browse
                </p>
                <p className="drop-zone-hint">
                  Supports JPEG, PNG, GIF, WebP (max 5MB)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  data-testid="image-file-input"
                />
              </div>
            ) : (
              <div className="image-preview" data-testid="image-preview">
                <img src={imagePreview} alt="Preview" />
                <div className="image-info">
                  <span>{imageFile?.name}</span>
                  <button
                    className="btn-secondary"
                    onClick={handleClearImage}
                    style={{ padding: '0.5rem 1rem' }}
                    data-testid="clear-image-btn"
                  >
                    <X size={14} />
                    Remove
                  </button>
                </div>
              </div>
            )}

            <motion.button
              className="btn-primary"
              onClick={handleGenerateImageCode}
              disabled={isGeneratingImage || !imageFile}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              data-testid="generate-image-code-btn"
            >
              {isGeneratingImage ? (
                <>
                  <div className="spinner" />
                  Uploading...
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Generate Image Code
                </>
              )}
            </motion.button>

            <AnimatePresence>
              {imageCode && (
                <motion.div
                  className="code-card"
                  variants={scaleIn}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  data-testid="image-code-card"
                >
                  <p className="code-label">Share this code</p>
                  <p className="code-value" data-testid="image-share-code">{imageCode}</p>
                  
                  <div className="code-actions">
                    <button
                      className="btn-secondary"
                      onClick={handleCopyImageCode}
                      data-testid="copy-image-code-btn"
                    >
                      {imageCopied ? <Check size={16} /> : <Copy size={16} />}
                      {imageCopied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowImageQR(!showImageQR)}
                      data-testid="toggle-image-qr-btn"
                    >
                      <QrCode size={16} />
                      {showImageQR ? "Hide QR" : "Show QR"}
                    </button>
                  </div>

                  <AnimatePresence>
                    {showImageQR && (
                      <motion.div
                        className="qr-container"
                        variants={scaleIn}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        data-testid="image-qr-code"
                      >
                        <QRCode value={imageCode} size={120} level="M" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {imageExpiry && (
                    <div className="expiration-timer" data-testid="image-expiry-timer">
                      <Clock size={14} />
                      Expires in {formatTimeRemaining(imageExpiry)}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Receiver Section */}
        <motion.section
          className="receiver-section"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          data-testid="receiver-section"
        >
          <div className="receiver-card">
            <h2 className="receiver-title">Receive Content</h2>
            <p className="receiver-subtitle">
              Enter the share code to instantly receive text or image
            </p>

            <input
              type="text"
              className="code-input"
              placeholder="XXXXXX"
              value={receiveCode}
              onChange={(e) => setReceiveCode(e.target.value.toUpperCase().slice(0, 6))}
              maxLength={6}
              data-testid="receive-code-input"
            />

            <motion.button
              className="btn-primary"
              onClick={handleReceive}
              disabled={isReceiving || receiveCode.length < 6}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              data-testid="receive-content-btn"
            >
              {isReceiving ? (
                <>
                  <div className="spinner" />
                  Receiving...
                </>
              ) : (
                <>
                  <Send size={18} />
                  Receive Content
                </>
              )}
            </motion.button>

            <AnimatePresence>
              {receivedContent && (
                <motion.div
                  className="received-content"
                  variants={fadeInUp}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  data-testid="received-content"
                >
                  <p className="received-label">
                    <Check size={16} className="success-check" />
                    Content Received
                  </p>

                  {receivedContent.content_type === "text" ? (
                    <>
                      <div className="received-text" data-testid="received-text">
                        {receivedContent.content}
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={handleCopyReceivedText}
                        style={{ marginTop: '1rem', width: '100%' }}
                        data-testid="copy-received-text-btn"
                      >
                        <Copy size={16} />
                        Copy Text
                      </button>
                    </>
                  ) : (
                    <>
                      <img
                        src={receivedContent.content}
                        alt="Received"
                        className="received-image"
                        data-testid="received-image"
                      />
                      <button
                        className="btn-secondary"
                        onClick={handleDownloadImage}
                        style={{ marginTop: '1rem', width: '100%' }}
                        data-testid="download-received-image-btn"
                      >
                        <Download size={16} />
                        Download Image
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        {/* Footer */}
        <motion.footer
          className="footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          data-testid="footer"
        >
          <div className="footer-content">
            <p className="footer-brand">OnBoard.in</p>
            <p className="footer-tagline">Realtime Clipboard Sharing</p>
            <div className="footer-links">
              <a href="#" className="footer-link">Privacy</a>
              <a href="#" className="footer-link">Terms</a>
              <a href="#" className="footer-link">GitHub</a>
            </div>
          </div>
        </motion.footer>
      </div>
    </div>
  );
}

export default App;
