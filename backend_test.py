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
        print(f"🔧 Testing API at: {self.api_url}")

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

    def test_create_text_clipboard(self):
        """Test creating a text clipboard entry"""
        test_text = "Hello from OnBoard.in! This is a test clipboard entry with some text content."
        
        success, response = self.run_test(
            "Create Text Clipboard",
            "POST",
            "clipboard", 
            200,
            data={
                "content": test_text,
                "content_type": "text"
            }
        )
        
        if success and 'code' in response:
            print(f"   Generated Code: {response['code']}")
            return response['code']
        return None

    def test_create_image_clipboard(self):
        """Test creating an image clipboard entry"""
        # Create a small test image (1x1 PNG)
        test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
        
        # Write to temporary file
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
            tmp_file.write(test_image_data)
            tmp_file_path = tmp_file.name
        
        try:
            with open(tmp_file_path, 'rb') as img_file:
                success, response = self.run_test(
                    "Create Image Clipboard",
                    "POST",
                    "clipboard/image",
                    200,
                    files={"file": ("test.png", img_file, "image/png")}
                )
            
            if success and 'code' in response:
                print(f"   Generated Image Code: {response['code']}")
                return response['code']
                
        finally:
            # Clean up temp file
            os.unlink(tmp_file_path)
            
        return None

    def test_receive_clipboard(self, code, expected_content_type="text"):
        """Test receiving clipboard content by code"""
        success, response = self.run_test(
            f"Receive {expected_content_type.title()} Clipboard",
            "POST",
            "clipboard/receive",
            200,
            data={"code": code}
        )
        
        if success:
            content_type = response.get('content_type')
            if content_type == expected_content_type:
                print(f"   Content Type: {content_type}")
                if content_type == "text":
                    print(f"   Content Length: {len(response.get('content', ''))}")
                elif content_type == "image":
                    content = response.get('content', '')
                    print(f"   Image Data URL Length: {len(content)}")
                    print(f"   Is Data URL: {content.startswith('data:image/')}")
                return True
            else:
                print(f"   Expected content_type: {expected_content_type}, got: {content_type}")
        return False

    def test_receive_invalid_code(self):
        """Test receiving with invalid code"""
        success, response = self.run_test(
            "Receive Invalid Code",
            "POST", 
            "clipboard/receive",
            404,
            data={"code": "INVALID"}
        )
        return success  # We expect a 404, so success here means test passed

    def test_api_root(self):
        """Test the API root endpoint"""
        success, response = self.run_test(
            "API Root",
            "GET",
            "",
            200
        )
        return success and 'message' in response

def main():
    print("🚀 Starting OnBoard.in API Tests")
    print("=" * 50)
    
    tester = OnBoardAPITester()
    
    # Test 1: Health Check
    if not tester.test_health_endpoint():
        print("❌ Health check failed - stopping tests")
        return 1
    
    # Test 2: API Root
    if not tester.test_api_root():
        print("❌ API root endpoint failed")
    
    # Test 3: Create Text Clipboard
    text_code = tester.test_create_text_clipboard()
    if not text_code:
        print("❌ Text clipboard creation failed")
    
    # Test 4: Create Image Clipboard 
    image_code = tester.test_create_image_clipboard()
    if not image_code:
        print("❌ Image clipboard creation failed")
    
    # Test 5: Receive Text Clipboard
    if text_code:
        if not tester.test_receive_clipboard(text_code, "text"):
            print(f"❌ Failed to receive text clipboard with code: {text_code}")
    
    # Test 6: Receive Image Clipboard
    if image_code:
        if not tester.test_receive_clipboard(image_code, "image"):
            print(f"❌ Failed to receive image clipboard with code: {image_code}")
    
    # Test 7: Invalid Code Handling
    if not tester.test_receive_invalid_code():
        print("❌ Invalid code handling failed")
    
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