from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, List, Optional
import uuid
import base64
import asyncio
import json
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Room Manager for WebSocket connections
class RoomManager:
    def __init__(self):
        # room_code -> list of WebSocket connections
        self.rooms: Dict[str, List[WebSocket]] = {}
        # room_code -> current content
        self.room_content: Dict[str, dict] = {}
    
    async def connect(self, websocket: WebSocket, room_code: str):
        await websocket.accept()
        if room_code not in self.rooms:
            self.rooms[room_code] = []
        self.rooms[room_code].append(websocket)
        logger.info(f"Client connected to room {room_code}. Total clients: {len(self.rooms[room_code])}")
        
        # Send current content to newly connected client
        if room_code in self.room_content:
            try:
                await websocket.send_json({
                    "type": "sync",
                    "content": self.room_content[room_code].get("content", ""),
                    "content_type": self.room_content[room_code].get("content_type", "text"),
                    "client_count": len(self.rooms[room_code])
                })
            except Exception as e:
                logger.error(f"Error sending initial sync: {e}")
        
        # Notify all clients about the new connection count
        await self.broadcast_client_count(room_code)
    
    def disconnect(self, websocket: WebSocket, room_code: str):
        if room_code in self.rooms:
            if websocket in self.rooms[room_code]:
                self.rooms[room_code].remove(websocket)
            if len(self.rooms[room_code]) == 0:
                del self.rooms[room_code]
                # Keep content for a while in case someone rejoins
            else:
                # Notify remaining clients
                try:
                    asyncio.create_task(self.broadcast_client_count(room_code))
                except Exception:
                    pass
        logger.info(f"Client disconnected from room {room_code}")
    
    async def broadcast_client_count(self, room_code: str):
        if room_code in self.rooms:
            count = len(self.rooms[room_code])
            for ws in self.rooms[room_code]:
                try:
                    await ws.send_json({"type": "client_count", "count": count})
                except Exception:
                    pass
    
    async def broadcast(self, room_code: str, message: dict, exclude: WebSocket = None):
        if room_code in self.rooms:
            for ws in self.rooms[room_code]:
                if ws != exclude:
                    try:
                        await ws.send_json(message)
                    except Exception as e:
                        logger.error(f"Error broadcasting to client: {e}")
    
    def update_content(self, room_code: str, content: str, content_type: str = "text"):
        self.room_content[room_code] = {
            "content": content,
            "content_type": content_type,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
    
    def get_content(self, room_code: str) -> Optional[dict]:
        return self.room_content.get(room_code)
    
    def get_client_count(self, room_code: str) -> int:
        return len(self.rooms.get(room_code, []))
    
    def room_exists(self, room_code: str) -> bool:
        return room_code in self.rooms or room_code in self.room_content

room_manager = RoomManager()

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
    room_code = generate_room_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=24)  # Rooms last 24 hours
    
    # Initialize room in database
    room_doc = {
        "room_code": room_code,
        "content": "",
        "content_type": "text",
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "updated_at": now.isoformat()
    }
    
    await db.rooms.insert_one(room_doc)
    
    # Initialize in memory
    room_manager.room_content[room_code] = {
        "content": "",
        "content_type": "text",
        "updated_at": now.isoformat()
    }
    
    logger.info(f"Room created: {room_code}")
    
    return RoomResponse(
        room_code=room_code,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat()
    )

@api_router.post("/room/join")
async def join_room(data: RoomJoin):
    """Check if room exists and get current content"""
    room_code = data.room_code.upper().strip()
    
    # Check in memory first
    if room_manager.room_exists(room_code):
        content = room_manager.get_content(room_code)
        return {
            "success": True,
            "room_code": room_code,
            "content": content.get("content", "") if content else "",
            "content_type": content.get("content_type", "text") if content else "text",
            "client_count": room_manager.get_client_count(room_code)
        }
    
    # Check in database
    room = await db.rooms.find_one({"room_code": room_code}, {"_id": 0})
    
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Check expiration
    expires_at = datetime.fromisoformat(room["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        await db.rooms.delete_one({"room_code": room_code})
        raise HTTPException(status_code=404, detail="Room has expired")
    
    # Load into memory
    room_manager.room_content[room_code] = {
        "content": room.get("content", ""),
        "content_type": room.get("content_type", "text"),
        "updated_at": room.get("updated_at", datetime.now(timezone.utc).isoformat())
    }
    
    return {
        "success": True,
        "room_code": room_code,
        "content": room.get("content", ""),
        "content_type": room.get("content_type", "text"),
        "client_count": room_manager.get_client_count(room_code)
    }

@api_router.get("/room/{room_code}/status")
async def room_status(room_code: str):
    """Get room status"""
    room_code = room_code.upper().strip()
    exists = room_manager.room_exists(room_code)
    
    if not exists:
        room = await db.rooms.find_one({"room_code": room_code}, {"_id": 0})
        exists = room is not None
    
    return RoomStatus(
        room_code=room_code,
        exists=exists,
        client_count=room_manager.get_client_count(room_code),
        has_content=room_code in room_manager.room_content and bool(room_manager.room_content[room_code].get("content"))
    )

@api_router.post("/room/content")
async def update_content(data: ContentUpdate):
    """Update room content via HTTP (fallback)"""
    room_code = data.room_code.upper().strip()
    
    if not room_manager.room_exists(room_code):
        # Check database
        room = await db.rooms.find_one({"room_code": room_code})
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
    
    # Update content
    room_manager.update_content(room_code, data.content, data.content_type)
    
    # Update in database
    await db.rooms.update_one(
        {"room_code": room_code},
        {
            "$set": {
                "content": data.content,
                "content_type": data.content_type,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    # Broadcast to all connected clients
    await room_manager.broadcast(room_code, {
        "type": "content_update",
        "content": data.content,
        "content_type": data.content_type
    })
    
    return {"success": True}

@api_router.post("/room/image")
async def upload_image(room_code: str, file: UploadFile = File(...)):
    """Upload image to room"""
    room_code = room_code.upper().strip()
    
    # Read file content
    content = await file.read()
    
    # Check file size (max 5MB)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 5MB limit")
    
    # Check file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    # Convert to base64
    base64_content = base64.b64encode(content).decode('utf-8')
    data_url = f"data:{file.content_type};base64,{base64_content}"
    
    # Update content
    room_manager.update_content(room_code, data_url, "image")
    
    # Update in database
    await db.rooms.update_one(
        {"room_code": room_code},
        {
            "$set": {
                "content": data_url,
                "content_type": "image",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    # Broadcast to all connected clients
    await room_manager.broadcast(room_code, {
        "type": "content_update",
        "content": data_url,
        "content_type": "image"
    })
    
    return {"success": True}

# WebSocket endpoint for realtime sync
@app.websocket("/ws/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    room_code = room_code.upper().strip()
    await room_manager.connect(websocket, room_code)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif data.get("type") == "content_update":
                content = data.get("content", "")
                content_type = data.get("content_type", "text")
                
                # Update in memory
                room_manager.update_content(room_code, content, content_type)
                
                # Broadcast to all other clients in the room
                await room_manager.broadcast(room_code, {
                    "type": "content_update",
                    "content": content,
                    "content_type": content_type
                }, exclude=websocket)
                
                # Persist to database (async, don't wait)
                asyncio.create_task(db.rooms.update_one(
                    {"room_code": room_code},
                    {
                        "$set": {
                            "content": content,
                            "content_type": content_type,
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }
                    },
                    upsert=True
                ))
            
            elif data.get("type") == "image_update":
                content = data.get("content", "")
                
                # Update in memory
                room_manager.update_content(room_code, content, "image")
                
                # Broadcast to all other clients
                await room_manager.broadcast(room_code, {
                    "type": "content_update",
                    "content": content,
                    "content_type": "image"
                }, exclude=websocket)
                
                # Persist to database
                asyncio.create_task(db.rooms.update_one(
                    {"room_code": room_code},
                    {
                        "$set": {
                            "content": content,
                            "content_type": "image",
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }
                    },
                    upsert=True
                ))
                
    except WebSocketDisconnect:
        room_manager.disconnect(websocket, room_code)
    except Exception as e:
        logger.error(f"WebSocket error for room {room_code}: {e}")
        room_manager.disconnect(websocket, room_code)

# Include the router in the main app
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        except Exception as e:
            logger.error(f"Cleanup error: {e}")
        await asyncio.sleep(300)  # Run every 5 minutes

@app.on_event("startup")
async def startup_event():
    # Create indexes
    await db.rooms.create_index("expires_at")
    await db.rooms.create_index("room_code", unique=True)
    # Start cleanup task
    asyncio.create_task(cleanup_expired())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
