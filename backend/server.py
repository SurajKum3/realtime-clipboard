from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
import os
import logging
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from pydantic import BaseModel
from typing import Dict, Optional, Set
import uuid
import base64
import asyncio
import json
import time
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Limits
ROOM_TTL = timedelta(hours=24)            # Rooms last 24 hours
MAX_TEXT_CHARS = 1_000_000                # ~1MB of text
MAX_IMAGE_BYTES = 5 * 1024 * 1024         # 5MB raw image
MAX_IMAGE_CHARS = MAX_IMAGE_BYTES * 4 // 3 + 1024  # base64 data URL of a 5MB image
ALLOWED_CONTENT_TYPES = ("text", "image")

PERSIST_DELAY = 0.5        # Debounce for database writes while someone is typing
PERSIST_RETRY_DELAY = 5
SEND_TIMEOUT = 15          # Drop clients that can't take a message in this long
CLEANUP_INTERVAL = 300     # Run cleanup every 5 minutes
IDLE_EVICT_SECONDS = 600   # Drop rooms nobody is using from memory (they stay in the database)

# WebSocket close code telling the client the room is gone and it should not reconnect
WS_ROOM_NOT_FOUND = 4404


def normalize_room_code(room_code: str) -> str:
    return room_code.upper().strip()


def validate_content(content, content_type) -> Optional[str]:
    """Returns an error message if the content can't be stored, otherwise None"""
    if content_type not in ALLOWED_CONTENT_TYPES:
        return "Invalid content type"
    if not isinstance(content, str):
        return "Content must be a string"
    if content_type == "text":
        if len(content) > MAX_TEXT_CHARS:
            return "Text is too large (max 1MB)"
    else:
        if not content.startswith("data:image/"):
            return "Invalid image"
        if len(content) > MAX_IMAGE_CHARS:
            return "Image size exceeds 5MB limit"
    return None


def parse_expiry(value: str) -> datetime:
    expires_at = datetime.fromisoformat(value)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at


@dataclass
class Room:
    code: str
    expires_at: datetime
    content: str = ""
    content_type: str = "text"
    # Increases on every content change, so clients can tell new content from stale content
    version: int = 0
    sockets: Set[WebSocket] = field(default_factory=set)
    dirty: bool = False
    last_access: float = field(default_factory=time.monotonic)

    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) > self.expires_at


# Room Manager for WebSocket connections
class RoomManager:
    def __init__(self):
        # room_code -> room state (content + connected clients)
        self.rooms: Dict[str, Room] = {}
        # room_code -> pending database write
        self._persist_tasks: Dict[str, asyncio.Task] = {}

    def add(self, room: Room) -> Room:
        self.rooms[room.code] = room
        return room

    async def load(self, room_code: str) -> Optional[Room]:
        """Get a room from memory, falling back to the database. None if missing or expired"""
        room = self.rooms.get(room_code)
        if room is None:
            doc = await db.rooms.find_one({"room_code": room_code}, {"_id": 0})
            if not doc:
                return None
            # Another request may have loaded the room while we were waiting on the database
            room = self.rooms.get(room_code)
            if room is None:
                room = self.add(Room(
                    code=room_code,
                    expires_at=parse_expiry(doc["expires_at"]),
                    content=doc.get("content", ""),
                    content_type=doc.get("content_type", "text"),
                    version=doc.get("version", 0),
                ))

        if room.is_expired():
            await self.remove(room)
            await db.rooms.delete_one({"room_code": room_code})
            return None

        room.last_access = time.monotonic()
        return room

    async def remove(self, room: Room):
        """Drop a room from memory and disconnect anyone still in it"""
        if self.rooms.get(room.code) is room:
            del self.rooms[room.code]
        task = self._persist_tasks.pop(room.code, None)
        if task:
            task.cancel()
        sockets, room.sockets = room.sockets, set()
        for ws in sockets:
            with suppress(Exception):
                await ws.close(code=WS_ROOM_NOT_FOUND)

    async def connect(self, room: Room, websocket: WebSocket):
        room.sockets.add(websocket)
        logger.info(f"Client connected to room {room.code}. Total clients: {len(room.sockets)}")

        # Send current content to newly connected client
        await self._send(room, websocket, json.dumps({
            "type": "sync",
            "content": room.content,
            "content_type": room.content_type,
            "version": room.version,
            "client_count": len(room.sockets)
        }))

        # Notify all clients about the new connection count
        await self.broadcast_client_count(room)

    async def disconnect(self, room: Room, websocket: WebSocket):
        room.sockets.discard(websocket)
        room.last_access = time.monotonic()
        logger.info(f"Client disconnected from room {room.code}")
        # Notify remaining clients
        await self.broadcast_client_count(room)

    async def _send(self, room: Room, websocket: WebSocket, text: str):
        try:
            await asyncio.wait_for(websocket.send_text(text), SEND_TIMEOUT)
        except Exception:
            # Dead or stuck client - drop it so it can't hold up the room
            room.sockets.discard(websocket)
            with suppress(Exception):
                await websocket.close()

    async def broadcast(self, room: Room, message: dict, exclude: WebSocket = None):
        targets = [ws for ws in room.sockets if ws is not exclude]
        if not targets:
            return
        text = json.dumps(message)
        await asyncio.gather(*(self._send(room, ws, text) for ws in targets))

    async def broadcast_client_count(self, room: Room):
        await self.broadcast(room, {"type": "client_count", "count": len(room.sockets)})

    def update_content(self, room: Room, content: str, content_type: str = "text") -> int:
        """Set the room content and return its new version"""
        room.content = content
        room.content_type = content_type
        # Wall clock based so versions keep increasing across server restarts
        room.version = max(room.version + 1, int(time.time() * 1000))
        room.last_access = time.monotonic()
        self._schedule_persist(room)
        return room.version

    def _schedule_persist(self, room: Room):
        room.dirty = True
        if room.code not in self._persist_tasks:
            self._persist_tasks[room.code] = asyncio.create_task(self._persist_later(room))

    async def _persist_later(self, room: Room):
        # One write per burst of typing instead of one per keystroke
        try:
            await asyncio.sleep(PERSIST_DELAY)
            while room.dirty:
                try:
                    await self._persist(room)
                except Exception as e:
                    logger.error(f"Error persisting room {room.code}: {e}")
                    await asyncio.sleep(PERSIST_RETRY_DELAY)
        finally:
            if self._persist_tasks.get(room.code) is asyncio.current_task():
                del self._persist_tasks[room.code]

    async def _persist(self, room: Room):
        room.dirty = False
        try:
            await db.rooms.update_one(
                {"room_code": room.code},
                {
                    "$set": {
                        "content": room.content,
                        "content_type": room.content_type,
                        "version": room.version,
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                }
            )
        except BaseException:
            room.dirty = True
            raise

    async def flush(self):
        """Write everything that is still waiting to be saved (used on shutdown)"""
        tasks = list(self._persist_tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for room in list(self.rooms.values()):
            if room.dirty:
                try:
                    await self._persist(room)
                except Exception as e:
                    logger.error(f"Error persisting room {room.code} on shutdown: {e}")

    async def cleanup(self):
        """Drop expired rooms, and idle rooms that are safely stored in the database"""
        now = time.monotonic()
        for room in list(self.rooms.values()):
            if room.is_expired():
                await self.remove(room)
            elif not room.sockets and not room.dirty and now - room.last_access > IDLE_EVICT_SECONDS:
                del self.rooms[room.code]

    def get_client_count(self, room_code: str) -> int:
        room = self.rooms.get(room_code)
        return len(room.sockets) if room else 0

room_manager = RoomManager()

# Cleanup expired rooms periodically
async def cleanup_expired():
    while True:
        try:
            now = datetime.now(timezone.utc).isoformat()
            result = await db.rooms.delete_many({
                "expires_at": {"$lt": now}
            })
            if result.deleted_count > 0:
                logger.info(f"Cleaned up {result.deleted_count} expired rooms")
            await room_manager.cleanup()
        except Exception as e:
            logger.error(f"Cleanup error: {e}")
        await asyncio.sleep(CLEANUP_INTERVAL)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create indexes
    await db.rooms.create_index("expires_at")
    await db.rooms.create_index("room_code", unique=True)
    # Start cleanup task
    cleanup_task = asyncio.create_task(cleanup_expired())
    yield
    cleanup_task.cancel()
    await room_manager.flush()
    client.close()

# Create the main app
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Pydantic Models
class RoomCreate(BaseModel):
    room_code: Optional[str] = None

class RoomResponse(BaseModel):
    room_code: str
    created_at: str
    expires_at: str

class RoomJoin(BaseModel):
    room_code: str

class RoomStatus(BaseModel):
    room_code: str
    exists: bool
    client_count: int
    has_content: bool

class ContentUpdate(BaseModel):
    room_code: str
    content: str
    content_type: str = "text"

# Generate unique 6-character room code
def generate_room_code() -> str:
    return uuid.uuid4().hex[:6].upper()

async def get_room_or_404(room_code: str) -> Room:
    room = await room_manager.load(normalize_room_code(room_code))
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found or expired")
    return room

async def set_room_content(room: Room, content: str, content_type: str, exclude: WebSocket = None) -> int:
    """Update room content and push it to connected clients. Returns the new version"""
    version = room_manager.update_content(room, content, content_type)
    await room_manager.broadcast(room, {
        "type": "content_update",
        "content": content,
        "content_type": content_type,
        "version": version
    }, exclude=exclude)
    return version

# API Routes
@api_router.get("/")
async def root():
    return {"message": "OnBoard.in API - Realtime Clipboard Sharing"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

@api_router.post("/room/create", response_model=RoomResponse)
async def create_room(data: RoomCreate = None):
    """Create a new clipboard room"""
    now = datetime.now(timezone.utc)
    expires_at = now + ROOM_TTL

    # Room codes are short, so retry on the rare collision
    for _ in range(5):
        room_code = generate_room_code()
        try:
            await db.rooms.insert_one({
                "room_code": room_code,
                "content": "",
                "content_type": "text",
                "version": 0,
                "created_at": now.isoformat(),
                "expires_at": expires_at.isoformat(),
                "updated_at": now.isoformat()
            })
            break
        except DuplicateKeyError:
            continue
    else:
        raise HTTPException(status_code=503, detail="Could not create a room. Please try again.")

    # Initialize in memory
    room_manager.add(Room(code=room_code, expires_at=expires_at))

    logger.info(f"Room created: {room_code}")

    return RoomResponse(
        room_code=room_code,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat()
    )

@api_router.post("/room/join")
async def join_room(data: RoomJoin):
    """Check if room exists and get current content"""
    room = await get_room_or_404(data.room_code)
    return {
        "success": True,
        "room_code": room.code,
        "content": room.content,
        "content_type": room.content_type,
        "version": room.version,
        "client_count": len(room.sockets)
    }

@api_router.get("/room/{room_code}/status")
async def room_status(room_code: str):
    """Get room status"""
    room_code = normalize_room_code(room_code)
    room = await room_manager.load(room_code)

    return RoomStatus(
        room_code=room_code,
        exists=room is not None,
        client_count=len(room.sockets) if room else 0,
        has_content=bool(room and room.content)
    )

@api_router.get("/room/{room_code}/content")
async def get_content(room_code: str, since: int = -1):
    """Get room content if it changed after version `since` (polling fallback)"""
    room = await get_room_or_404(room_code)
    response = {
        "room_code": room.code,
        "version": room.version,
        "client_count": len(room.sockets),
        "changed": room.version > since
    }
    if response["changed"]:
        response["content"] = room.content
        response["content_type"] = room.content_type
    return response

@api_router.post("/room/content")
async def update_content(data: ContentUpdate):
    """Update room content via HTTP (fallback)"""
    room = await get_room_or_404(data.room_code)

    error = validate_content(data.content, data.content_type)
    if error:
        raise HTTPException(status_code=413 if "large" in error or "exceeds" in error else 400, detail=error)

    version = await set_room_content(room, data.content, data.content_type)

    return {"success": True, "version": version}

@api_router.post("/room/image")
async def upload_image(room_code: str, file: UploadFile = File(...)):
    """Upload image to room"""
    room = await get_room_or_404(room_code)

    # Check file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type")

    # Read file content, stopping as soon as it is over the size limit (max 5MB)
    content = await file.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="File size exceeds 5MB limit")

    # Convert to base64
    base64_content = base64.b64encode(content).decode('utf-8')
    data_url = f"data:{file.content_type};base64,{base64_content}"

    version = await set_room_content(room, data_url, "image")

    return {"success": True, "version": version}

# WebSocket endpoint for realtime sync
@app.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    room_code = normalize_room_code(room_code)
    await websocket.accept()

    try:
        room = await room_manager.load(room_code)
    except Exception as e:
        logger.error(f"Error loading room {room_code}: {e}")
        with suppress(Exception):
            await websocket.close(code=1011)
        return

    if room is None:
        await websocket.close(code=WS_ROOM_NOT_FOUND)
        return

    await room_manager.connect(room, websocket)

    try:
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue

            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

            elif data.get("type") in ("content_update", "image_update"):
                content = data.get("content", "")
                content_type = "image" if data["type"] == "image_update" else data.get("content_type", "text")

                error = validate_content(content, content_type)
                if error:
                    await websocket.send_json({"type": "error", "message": error, "seq": data.get("seq")})
                    continue

                # Room expired while the client was still connected
                if room_manager.rooms.get(room_code) is not room:
                    await websocket.close(code=WS_ROOM_NOT_FOUND)
                    break

                # Update in memory (persisted to the database in the background)
                version = room_manager.update_content(room, content, content_type)

                # Tell the sender which version its change became, before anyone else's
                # newer change can reach it
                await websocket.send_json({"type": "ack", "seq": data.get("seq"), "version": version})

                # Broadcast to all other clients in the room
                await room_manager.broadcast(room, {
                    "type": "content_update",
                    "content": content,
                    "content_type": content_type,
                    "version": version
                }, exclude=websocket)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error for room {room_code}: {e}")
        with suppress(Exception):
            await websocket.close()
    finally:
        await room_manager.disconnect(room, websocket)

# Include the router in the main app
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.environ.get('CORS_ORIGINS', '*').split(',') if origin.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
