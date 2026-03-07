# OnBoard.in - Realtime Clipboard Sharing

## Original Problem Statement
Build a premium realtime clipboard web application called **OnBoard.in** - a fast, frictionless, realtime clipboard bridge between devices. Users can share text (up to 5000 lines) or images with a simple 6-character share code.

## User Personas
- **Professionals**: Need quick clipboard sharing between work devices
- **Developers**: Share code snippets between machines
- **Designers**: Transfer images between devices easily
- **General Users**: Anyone needing cross-device clipboard functionality

## Core Requirements (Static)
1. Text clipboard: paste up to 5000 lines, generate share code
2. Image clipboard: drag-drop or click to upload (max 5MB), generate share code
3. 6-character unique share codes
4. Codes expire after 5 minutes
5. QR code generation for easy mobile scanning
6. Copy-to-clipboard functionality
7. Realtime content reception without page refresh
8. Light theme with premium SaaS design
9. Responsive for desktop, tablet, mobile

## What's Been Implemented (2026-03-07)
- [x] FastAPI backend with WebSocket support (/ws/{code} endpoint)
- [x] MongoDB for clipboard storage
- [x] Text clipboard with share code generation
- [x] Image clipboard with upload and share code
- [x] QR code generation for both text and image codes
- [x] Copy button functionality
- [x] Receiver section to retrieve content by code
- [x] Code expiration (5 minutes) with countdown timer
- [x] Automatic cleanup of expired codes
- [x] Premium UI with Manrope/Inter/JetBrains Mono fonts
- [x] Framer Motion animations
- [x] Sonner toast notifications
- [x] Full responsive design

### Realtime WebSocket Features (2026-03-07)
- [x] WebSocket endpoint on backend (/ws/{code})
- [x] Frontend WebSocket connection for senders (auto-connect on code generation)
- [x] "Listen Realtime" button for receivers to wait for push updates
- [x] Connection status indicator (Connecting.../Live)
- [x] Ping/pong keepalive mechanism (30s interval)
- [x] HTTP "Fetch Now" fallback for when WebSocket unavailable
- [x] Stop listening button to disconnect WebSocket

**Note**: WebSocket connections are blocked by Kubernetes Ingress/Cloudflare proxy configuration. The HTTP fallback works perfectly. Infrastructure configuration needed for full realtime support.

## Tech Stack
- **Frontend**: React 19, Framer Motion, React QR Code, Sonner
- **Backend**: FastAPI, Motor (MongoDB async driver)
- **Database**: MongoDB
- **Styling**: TailwindCSS, Custom CSS

## Prioritized Backlog

### P0 (Critical) - DONE
- Core clipboard sharing functionality ✅
- Share code generation ✅
- Content retrieval ✅

### P1 (High Priority)
- WebSocket realtime push updates (backend ready, frontend uses polling)
- Password-protected clipboard entries
- Link preview for URLs in text

### P2 (Medium Priority)
- Multiple file upload support
- Clipboard history for authenticated users
- Browser extension for quick sharing
- Mobile app (PWA)

## Next Action Items
1. Implement true realtime WebSocket updates on frontend
2. Add password protection option for sensitive content
3. Consider adding user accounts for clipboard history
4. PWA support for mobile installation
