#!/usr/bin/env python3

import asyncio
import websockets
import json
import sys
import time
from pathlib import Path

class WebSocketTester:
    def __init__(self):
        # Read backend URL from frontend .env
        frontend_env_path = Path("/app/frontend/.env")
        self.base_url = None
        
        if frontend_env_path.exists():
            with open(frontend_env_path, 'r') as f:
                for line in f:
                    if line.startswith('REACT_APP_BACKEND_URL='):
                        self.base_url = line.split('=', 1)[1].strip().strip('"')
                        break
        
        if not self.base_url:
            print("❌ Could not find REACT_APP_BACKEND_URL in frontend/.env")
            sys.exit(1)
            
        # Convert HTTP URL to WebSocket URL
        if self.base_url.startswith('https://'):
            self.ws_base = self.base_url.replace('https://', 'wss://')
        else:
            self.ws_base = self.base_url.replace('http://', 'ws://')
            
        self.tests_run = 0
        self.tests_passed = 0
        print(f"🔧 Testing WebSocket at: {self.ws_base}")

    async def test_websocket_connection(self, code):
        """Test basic WebSocket connection"""
        self.tests_run += 1
        print(f"\n🔍 Testing WebSocket Connection to /ws/{code}...")
        
        ws_url = f"{self.ws_base}/ws/{code}"
        print(f"   URL: {ws_url}")
        
        try:
            async with websockets.connect(ws_url) as websocket:
                print("✅ WebSocket connected successfully")
                
                # Test ping/pong
                ping_message = {"type": "ping"}
                await websocket.send(json.dumps(ping_message))
                print("   Sent ping message")
                
                # Wait for pong response
                response = await asyncio.wait_for(websocket.recv(), timeout=5)
                response_data = json.loads(response)
                
                if response_data.get("type") == "pong":
                    print("✅ Received pong response")
                    self.tests_passed += 1
                    return True
                else:
                    print(f"❌ Expected pong, got: {response_data}")
                    return False
                    
        except websockets.exceptions.ConnectionClosed:
            print("❌ WebSocket connection closed unexpectedly")
            return False
        except asyncio.TimeoutError:
            print("❌ WebSocket connection timeout")
            return False
        except Exception as e:
            print(f"❌ WebSocket error: {str(e)}")
            return False

    async def test_websocket_content_push(self, code):
        """Test sending content via WebSocket"""
        self.tests_run += 1
        print(f"\n🔍 Testing WebSocket Content Push to /ws/{code}...")
        
        ws_url = f"{self.ws_base}/ws/{code}"
        
        try:
            async with websockets.connect(ws_url) as websocket:
                print("✅ WebSocket connected for content push")
                
                # Send content message
                content_message = {
                    "type": "content",
                    "content": "Test content via WebSocket",
                    "content_type": "text"
                }
                await websocket.send(json.dumps(content_message))
                print("   Sent content message")
                
                # Wait for content update response
                response = await asyncio.wait_for(websocket.recv(), timeout=5)
                response_data = json.loads(response)
                
                if response_data.get("type") == "content_update":
                    print("✅ Received content_update response")
                    print(f"   Content: {response_data.get('content', '')[:50]}...")
                    self.tests_passed += 1
                    return True
                else:
                    print(f"❌ Expected content_update, got: {response_data}")
                    return False
                    
        except websockets.exceptions.ConnectionClosed:
            print("❌ WebSocket connection closed during content push")
            return False
        except asyncio.TimeoutError:
            print("❌ WebSocket content push timeout")
            return False
        except Exception as e:
            print(f"❌ WebSocket content push error: {str(e)}")
            return False

    async def test_multiple_websocket_connections(self, code):
        """Test multiple WebSocket connections to same code"""
        self.tests_run += 1
        print(f"\n🔍 Testing Multiple WebSocket Connections to /ws/{code}...")
        
        ws_url = f"{self.ws_base}/ws/{code}"
        
        try:
            # Connect two WebSockets to the same code
            async with websockets.connect(ws_url) as ws1:
                async with websockets.connect(ws_url) as ws2:
                    print("✅ Multiple WebSocket connections established")
                    
                    # Send content from first connection
                    content_message = {
                        "type": "content", 
                        "content": "Multi-connection test",
                        "content_type": "text"
                    }
                    await ws1.send(json.dumps(content_message))
                    print("   Sent content from first connection")
                    
                    # Both should receive the update
                    response1 = await asyncio.wait_for(ws1.recv(), timeout=5)
                    print("✅ First connection received response")
                    
                    self.tests_passed += 1
                    return True
                    
        except Exception as e:
            print(f"❌ Multiple WebSocket test error: {str(e)}")
            return False

    async def run_all_tests(self):
        """Run all WebSocket tests"""
        print("🚀 Starting WebSocket Tests")
        print("=" * 50)
        
        # Use a test code
        test_code = "TEST01"
        
        # Test 1: Basic WebSocket Connection
        await self.test_websocket_connection(test_code)
        
        # Test 2: Content Push
        await self.test_websocket_content_push(test_code)
        
        # Test 3: Multiple Connections  
        await self.test_multiple_websocket_connections(test_code)
        
        # Print results
        print("\n" + "=" * 50)
        print(f"📊 WebSocket Tests Results: {self.tests_passed}/{self.tests_run}")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All WebSocket tests passed!")
            return 0
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} WebSocket tests failed")
            return 1

async def main():
    tester = WebSocketTester()
    return await tester.run_all_tests()

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)