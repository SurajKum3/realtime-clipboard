#!/usr/bin/env python3

import requests
import sys
import json
import time
import tempfile
import os
from datetime import datetime
from pathlib import Path

class OnBoardAPITester:
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
            
        self.api_url = f"{self.base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        print(f"🔧 Testing OnBoard.in Room API at: {self.api_url}")

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        headers = {}
        
        # Don't set Content-Type for multipart/form-data (file uploads)
        if not files:
            headers['Content-Type'] = 'application/json'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                if files:
                    response = requests.post(url, data=data, files=files, timeout=15)
                else:
                    response = requests.post(url, json=data, headers=headers, timeout=15)
            else:
                print(f"❌ Unsupported HTTP method: {method}")
                return False, {}

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return success, response.json()
                except:
                    return success, {"raw_response": response.text}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")
                return False, {}

        except requests.exceptions.RequestException as e:
            print(f"❌ Failed - Network Error: {str(e)}")
            return False, {}
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_endpoint(self):
        """Test the /api/health endpoint"""
        success, response = self.run_test(
            "Health Check",
            "GET", 
            "health",
            200
        )
        
        if success and 'status' in response:
            print(f"   Health Status: {response['status']}")
            return response.get('status') == 'healthy'
        return False

    def test_api_root(self):
        """Test the API root endpoint"""
        success, response = self.run_test(
            "API Root",
            "GET",
            "",
            200
        )
        if success and 'message' in response:
            print(f"   Message: {response['message']}")
            return True
        return success

    def test_create_room(self):
        """Test creating a new room"""
        success, response = self.run_test(
            "Create Room",
            "POST", 
            "room/create",
            200,
            data={}
        )
        
        if success and 'room_code' in response:
            room_code = response['room_code']
            print(f"   Generated Room Code: {room_code}")
            print(f"   Created At: {response.get('created_at')}")
            print(f"   Expires At: {response.get('expires_at')}")
            return room_code
        return None

    def test_join_room(self, room_code):
        """Test joining an existing room"""
        success, response = self.run_test(
            "Join Room",
            "POST",
            "room/join", 
            200,
            data={"room_code": room_code}
        )
        
        if success:
            print(f"   Joined Room: {response.get('room_code')}")
            print(f"   Content: '{response.get('content', '')[:50]}{'...' if len(response.get('content', '')) > 50 else ''}'")
            print(f"   Content Type: {response.get('content_type')}")
            print(f"   Client Count: {response.get('client_count')}")
            return True
        return False

    def test_join_invalid_room(self):
        """Test joining with invalid room code"""
        success, response = self.run_test(
            "Join Invalid Room",
            "POST",
            "room/join",
            404,
            data={"room_code": "INVALID"}
        )
        return success  # We expect a 404, so success here means test passed

    def test_room_status(self, room_code):
        """Test getting room status"""
        success, response = self.run_test(
            "Room Status",
            "GET",
            f"room/{room_code}/status",
            200
        )
        
        if success:
            print(f"   Room Exists: {response.get('exists')}")
            print(f"   Client Count: {response.get('client_count')}")
            print(f"   Has Content: {response.get('has_content')}")
            return response.get('exists', False)
        return False

    def test_update_room_content(self, room_code):
        """Test updating room content via HTTP"""
        test_content = "Hello from OnBoard.in! This is a test message for room content sync."
        
        success, response = self.run_test(
            "Update Room Content",
            "POST",
            "room/content",
            200,
            data={
                "room_code": room_code,
                "content": test_content,
                "content_type": "text"
            }
        )
        
        if success and response.get('success'):
            print(f"   Content Updated Successfully")
            return test_content
        return None

    def test_upload_room_image(self, room_code):
        """Test uploading image to room"""
        # Create a small test image (1x1 PNG)
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
        
        # Write to temporary file
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
            tmp_file.write(test_image_data)
            tmp_file_path = tmp_file.name
        
        try:
            with open(tmp_file_path, 'rb') as img_file:
                # Test image upload endpoint - room_code should be query parameter
                url = f"{self.api_url}/room/image"
                response = requests.post(
                    url,
                    params={"room_code": room_code},
                    files={"file": ("test.png", img_file, "image/png")},
                    timeout=15
                )
                
                self.tests_run += 1
                print(f"\n🔍 Testing Upload Room Image...")
                print(f"   URL: {url}")
                
                if response.status_code == 200:
                    self.tests_passed += 1
                    print(f"✅ Passed - Status: {response.status_code}")
                    try:
                        resp_data = response.json()
                        if resp_data.get('success'):
                            print(f"   Image Upload Successful")
                            return True
                    except:
                        pass
                else:
                    print(f"❌ Failed - Expected 200, got {response.status_code}")
                    print(f"   Response: {response.text[:200]}...")
                
        except Exception as e:
            self.tests_run += 1
            print(f"❌ Failed - Error: {str(e)}")
        finally:
            # Clean up temp file
            os.unlink(tmp_file_path)
            
        return False

    def test_websocket_url_format(self):
        """Test that WebSocket URL format is correct"""
        room_code = "TEST123"
        expected_ws_url = f"wss://{self.base_url.replace('https://', '').replace('http://', '')}/ws/{room_code}"
        
        print(f"\n🔍 Testing WebSocket URL Format...")
        print(f"   Expected WS URL: {expected_ws_url}")
        print(f"   Base URL: {self.base_url}")
        
        # Just validate URL format, can't test actual WebSocket connection easily
        if expected_ws_url.startswith("wss://") and expected_ws_url.endswith(f"/ws/{room_code}"):
            print("✅ WebSocket URL format looks correct")
            return True
        else:
            print("❌ WebSocket URL format may be incorrect")
            return False

def main():
    print("🚀 Starting OnBoard.in Room API Tests")
    print("=" * 50)
    
    tester = OnBoardAPITester()
    
    # Test 1: Health Check
    if not tester.test_health_endpoint():
        print("❌ Health check failed - stopping tests")
        return 1
    
    # Test 2: API Root
    if not tester.test_api_root():
        print("❌ API root endpoint failed")
    
    # Test 3: Create Room
    room_code = tester.test_create_room()
    if not room_code:
        print("❌ Room creation failed - stopping tests")
        return 1
    
    # Test 4: Room Status (should exist)
    if not tester.test_room_status(room_code):
        print(f"❌ Room status check failed for room: {room_code}")
    
    # Test 5: Join Room
    if not tester.test_join_room(room_code):
        print(f"❌ Failed to join room: {room_code}")
    
    # Test 6: Update Room Content
    updated_content = tester.test_update_room_content(room_code)
    if not updated_content:
        print("❌ Failed to update room content")
    
    # Test 7: Upload Image to Room
    if not tester.test_upload_room_image(room_code):
        print("❌ Failed to upload image to room")
    
    # Test 8: Join after content update (should have content now)
    print(f"\n🔍 Re-testing join room after content update...")
    if not tester.test_join_room(room_code):
        print(f"❌ Failed to re-join room after content update: {room_code}")
    
    # Test 9: Invalid Room Code Handling
    if not tester.test_join_invalid_room():
        print("❌ Invalid room code handling failed")
    
    # Test 10: WebSocket URL Format Check
    if not tester.test_websocket_url_format():
        print("❌ WebSocket URL format check failed")
    
    # Print final results
    print("\n" + "=" * 50)
    print(f"📊 Tests Results: {tester.tests_passed}/{tester.tests_run}")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All API tests passed!")
        return 0
    else:
        print(f"⚠️  {tester.tests_run - tester.tests_passed} tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())