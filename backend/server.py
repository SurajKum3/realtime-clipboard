from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import Dict, Optional
import uuid
import base64
import asyncio
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

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, code: str):
        await websocket.accept()
        self.active_connections[code] = websocket
        logger.info(f"WebSocket connected for code: {code}")
    
    def disconnect(self, code: str):
        if code in self.active_connections:
            del self.active_connections[code]
            logger.info(f"WebSocket disconnected for code: {code}")
    
    async def send_to_code(self, code: str, message: dict):
        if code in self.active_connections:
            try:
                await self.active_connections[code].send_json(message)
                logger.info(f"Message sent to code: {code}")
                return True
            except Exception as e:
                logger.error(f"Error sending to {code}: {e}")
                return False
        return False

manager = ConnectionManager()

# Pydantic Models
class ClipboardCreate(BaseModel):
    content: str
    content_type: str = "text"  # "text" or "image"

class ClipboardResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str
    content_type: str
    created_at: str
    expires_at: str

class ReceiveRequest(BaseModel):
    code: str

class ClipboardContent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str
    content: str
    content_type: str
    created_at: str
    expires_at: str

# Generate unique 6-character code
def generate_code() -> str:
    return uuid.uuid4().hex[:6].upper()

# API Routes
@api_router.get("/")
async def root():
    return {"message": "OnBoard.in API - Realtime Clipboard Sharing"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}

@api_router.post("/clipboard", response_model=ClipboardResponse)
async def create_clipboard(data: ClipboardCreate):
    """Create a new clipboard entry with a share code"""
    code = generate_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=5)
    
    clipboard_doc = {
        "code": code,
        "content": data.content,
        "content_type": data.content_type,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat()
    }
    
    await db.clipboards.insert_one(clipboard_doc)
    logger.info(f"Clipboard created with code: {code}")
    
    return ClipboardResponse(
        code=code,
        content_type=data.content_type,
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat()
    )

@api_router.post("/clipboard/image", response_model=ClipboardResponse)
async def create_image_clipboard(file: UploadFile = File(...)):
    """Upload an image and create clipboard entry"""
    # Read file content
    content = await file.read()
    
    # Check file size (max 5MB)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 5MB limit")
    
    # Check file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, GIF, WebP")
    
    # Convert to base64
    base64_content = base64.b64encode(content).decode('utf-8')
    data_url = f"data:{file.content_type};base64,{base64_content}"
    
    code = generate_code()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=5)
    
    clipboard_doc = {
        "code": code,
        "content": data_url,
        "content_type": "image",
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat()
    }
    
    await db.clipboards.insert_one(clipboard_doc)
    logger.info(f"Image clipboard created with code: {code}")
    
    return ClipboardResponse(
        code=code,
        content_type="image",
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat()
    )

@api_router.post("/clipboard/receive", response_model=ClipboardContent)
async def receive_clipboard(data: ReceiveRequest):
    """Receive clipboard content by code"""
    code = data.code.upper().strip()
    
    clipboard = await db.clipboards.find_one(
        {"code": code},
        {"_id": 0}
    )
    
    if not clipboard:
        raise HTTPException(status_code=404, detail="Code not found or expired")
    
    # Check expiration
    expires_at = datetime.fromisoformat(clipboard["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        # Delete expired entry
        await db.clipboards.delete_one({"code": code})
        raise HTTPException(status_code=404, detail="Code has expired")
    
    return ClipboardContent(**clipboard)

@api_router.get("/clipboard/{code}")
async def get_clipboard(code: str):
    """Get clipboard by code (alternative to POST)"""
    code = code.upper().strip()
    
    clipboard = await db.clipboards.find_one(
        {"code": code},
        {"_id": 0}
    )
    
    if not clipboard:
        raise HTTPException(status_code=404, detail="Code not found or expired")
    
    # Check expiration
    expires_at = datetime.fromisoformat(clipboard["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        await db.clipboards.delete_one({"code": code})
        raise HTTPException(status_code=404, detail="Code has expired")
    
    return clipboard

# WebSocket endpoint for realtime updates
@app.websocket("/ws/{code}")
async def websocket_endpoint(websocket: WebSocket, code: str):
    code = code.upper().strip()
    await manager.connect(websocket, code)
    try:
        while True:
            # Keep connection alive and listen for messages
            data = await websocket.receive_json()
            
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif data.get("type") == "content":
                # Sender is pushing content - notify receiver
                content = data.get("content", "")
                content_type = data.get("content_type", "text")
                
                # Store in database
                now = datetime.now(timezone.utc)
                expires_at = now + timedelta(minutes=5)
                
                await db.clipboards.update_one(
                    {"code": code},
                    {
                        "$set": {
                            "content": content,
                            "content_type": content_type,
                            "created_at": now.isoformat(),
                            "expires_at": expires_at.isoformat()
                        }
                    },
                    upsert=True
                )
                
                # Broadcast to any listeners on this code
                await websocket.send_json({
                    "type": "content_update",
                    "content": content,
                    "content_type": content_type
                })
                
    except WebSocketDisconnect:
        manager.disconnect(code)
    except Exception as e:
        logger.error(f"WebSocket error for {code}: {e}")
        manager.disconnect(code)

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

# Cleanup expired clipboards periodically
async def cleanup_expired():
    while True:
        try:
            now = datetime.now(timezone.utc).isoformat()
            result = await db.clipboards.delete_many({
                "expires_at": {"$lt": now}
            })
            if result.deleted_count > 0:
                logger.info(f"Cleaned up {result.deleted_count} expired clipboards")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")
        await asyncio.sleep(60)  # Run every minute

@app.on_event("startup")
async def startup_event():
    # Create index for expiration
    await db.clipboards.create_index("expires_at")
    await db.clipboards.create_index("code", unique=True)
    # Start cleanup task
    asyncio.create_task(cleanup_expired())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
