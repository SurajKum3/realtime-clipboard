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

### Core Features (Complete Redesign)
- [x] Room-based clipboard workflow (like live-clipboard.netlify.app)
- [x] Home page with "Create Clipboard" and "Join Clipboard" cards
- [x] 6-character room codes for easy sharing
- [x] Room view with Text/Image mode toggle
- [x] Large textarea for realtime clipboard sync
- [x] Image upload with drag-drop and preview
- [x] Room code display with copy button and QR code
- [x] Connection status indicator (Connecting/Live)
- [x] User count display
- [x] Leave room functionality
- [x] Line count and copy content button
- [x] 24-hour room expiration

### Backend
- [x] FastAPI with WebSocket support
- [x] Room management (create, join, content sync)
- [x] MongoDB for persistent room storage
- [x] HTTP fallback endpoints for content sync
- [x] Automatic room cleanup

### Sync Mechanism
- [x] WebSocket endpoint (/ws/{room_code}) for realtime sync
- [x] HTTP polling fallback (1-second intervals) - always active for reliability
- [x] Content changes sync to all connected devices
- [x] Image sharing via base64 encoding
- [x] "Live" status indicator shows when sync is active
- [x] Sync status shows at bottom: "Changes sync across all devices"

**Infrastructure Note**: WebSocket connections blocked by Kubernetes/Cloudflare proxy. HTTP polling provides reliable 1-second sync intervals. For true instant sync (<100ms), configure a WebSocket proxy in the Kubernetes Ingress.

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
