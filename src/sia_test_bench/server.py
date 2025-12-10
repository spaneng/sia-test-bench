import asyncio
import json
import logging
import os
import random
import time
from pathlib import Path
from typing import Set

import aiohttp
from aiohttp import web
from aiohttp.web_runner import AppRunner, TCPSite

from .app_state import SiaTestBenchState

log = logging.getLogger()


class TestBenchServer:
    """Web server for the SIA Test Bench application."""
    
    def __init__(self, state: SiaTestBenchState = None):
        self.state = state or SiaTestBenchState()
        self.app: web.Application = None
        self.runner: AppRunner = None
        self.site: TCPSite = None
        self.websockets: Set[web.WebSocketResponse] = set()
        self.pump_state: str = 'warning_disabled'
        self.is_running: bool = False
        self.target_flow: float = 0.0
        self.data_generation_task: asyncio.Task = None

    async def setup(self):
        """Initialize the web server."""
        # Create aiohttp application
        self.app = web.Application()
        
        # Setup routes
        self.app.router.add_get('/ws', self.websocket_handler)
        self.app.router.add_get('/api/pumps', self.get_pumps_handler)
        self.app.router.add_post('/api/pump/start', self.start_pump_handler)
        self.app.router.add_post('/api/pump/stop', self.stop_pump_handler)
        
        # Serve static files from frontend dist directory
        frontend_dist = Path(__file__).parent / 'frontend' / 'dist'
        if frontend_dist.exists():
            self.app.router.add_static('/', frontend_dist, name='static')
            # Catch-all route to serve index.html for SPA routing
            self.app.router.add_get('/{path:.*}', self.index_handler)
        else:
            log.warning(f"Frontend dist directory not found at {frontend_dist}")
        
        # Start the web server
        self.runner = AppRunner(self.app)
        await self.runner.setup()
        
        # Get port from environment or use default
        port = int(os.environ.get('PORT', '8080'))
        self.site = TCPSite(self.runner, '0.0.0.0', port)
        await self.site.start()
        
        log.info(f"Web server started on port {port}")
        
        # Start data generation task
        self.data_generation_task = asyncio.create_task(self.generate_system_data())

    async def main_loop(self):
        """Main server loop."""
        # The server runs in the background, so we just sleep here
        await asyncio.sleep(1)
    
    async def cleanup(self):
        """Cleanup resources when shutting down."""
        if self.data_generation_task:
            self.data_generation_task.cancel()
            try:
                await self.data_generation_task
            except asyncio.CancelledError:
                pass
        
        # Close all WebSocket connections
        for ws in list(self.websockets):
            await ws.close()
        self.websockets.clear()
        
        # Stop the web server
        if self.site:
            await self.site.stop()
        if self.runner:
            await self.runner.cleanup()
        
        log.info("Web server stopped")

    async def websocket_handler(self, request: web.Request) -> web.WebSocketResponse:
        """Handle WebSocket connections."""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        self.websockets.add(ws)
        log.info(f"WebSocket client connected. Total clients: {len(self.websockets)}")
        
        # Send initial state
        await self.broadcast_state()
        
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        await self.handle_websocket_message(data, ws)
                    except json.JSONDecodeError as e:
                        log.error(f"Invalid JSON received: {e}")
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    log.error(f"WebSocket error: {ws.exception()}")
        except Exception as e:
            log.error(f"WebSocket error: {e}")
        finally:
            self.websockets.discard(ws)
            log.info(f"WebSocket client disconnected. Total clients: {len(self.websockets)}")
        
        return ws

    async def handle_websocket_message(self, data: dict, ws: web.WebSocketResponse):
        """Handle incoming WebSocket messages."""
        message_type = data.get('type')
        
        if message_type == 'control':
            # Handle control commands
            command = data.get('command')
            if command == 'start':
                await self.start_pump()
            elif command == 'stop':
                await self.stop_pump()
            elif command == 'set_target_flow':
                self.target_flow = float(data.get('value', 0))
                log.info(f"Target flow set to {self.target_flow} GPM")
        elif message_type == 'get_state':
            # Send current state
            await self.send_state_to_client(ws)
        else:
            log.debug(f"Unknown message type: {message_type}")

    async def generate_system_data(self):
        """Generate and broadcast system data periodically."""
        while True:
            try:
                if self.is_running and self.pump_state == 'on':
                    # Generate realistic pump data when running
                    data = {
                        'type': 'data',
                        'timestamp': int(time.time() * 1000),
                        'pressure': round(random.uniform(20, 100), 2),
                        'flowRate': round(random.uniform(0, self.target_flow * 1.1), 2),
                        'temperature': round(random.uniform(65, 85), 2),
                        'voltage': round(random.uniform(110, 120), 2),
                        'current': round(random.uniform(3, 10), 2),
                    }
                else:
                    # Generate minimal/no data when not running
                    data = {
                        'type': 'data',
                        'timestamp': int(time.time() * 1000),
                        'pressure': round(random.uniform(0, 5), 2),
                        'flowRate': 0.0,
                        'temperature': round(random.uniform(65, 75), 2),
                        'voltage': round(random.uniform(110, 120), 2),
                        'current': round(random.uniform(0, 0.5), 2),
                    }
                
                await self.broadcast_data(data)
                
            except Exception as e:
                log.error(f"Error generating system data: {e}")
            
            await asyncio.sleep(0.5)  # Send data every 500ms

    async def broadcast_data(self, data: dict):
        """Broadcast data to all connected WebSocket clients."""
        if not self.websockets:
            return
        
        message = json.dumps(data)
        disconnected = set()
        
        for ws in self.websockets:
            try:
                await ws.send_str(message)
            except Exception as e:
                log.error(f"Error sending data to client: {e}")
                disconnected.add(ws)
        
        # Remove disconnected clients
        self.websockets -= disconnected

    async def broadcast_state(self):
        """Broadcast current state to all connected WebSocket clients."""
        await self.broadcast_data({
            'type': 'state',
            'state': self.pump_state
        })

    async def send_state_to_client(self, ws: web.WebSocketResponse):
        """Send current state to a specific client."""
        try:
            await ws.send_str(json.dumps({
                'type': 'state',
                'state': self.pump_state
            }))
        except Exception as e:
            log.error(f"Error sending state to client: {e}")

    async def get_pumps_handler(self, request: web.Request) -> web.Response:
        """Handle GET /api/pumps - return available pump types."""
        pumps = [
            {
                'id': '1',
                'name': 'SIA Pump Model A',
                'model': 'Model A',
                'maxRPM': 3000,
                'maxFlowRate': 50,
                'maxPressure': 100,
                'currentDraw': 5.5,
                'strokeLength': 2.5
            },
            {
                'id': '2',
                'name': 'SIA Pump Model B',
                'model': 'Model B',
                'maxRPM': 3500,
                'maxFlowRate': 75,
                'maxPressure': 120,
                'currentDraw': 7.2,
                'strokeLength': 3.0
            },
            {
                'id': '3',
                'name': 'SIA Pump Model C',
                'model': 'Model C',
                'maxRPM': 4000,
                'maxFlowRate': 100,
                'maxPressure': 150,
                'currentDraw': 9.5,
                'strokeLength': 3.5
            },
        ]
        return web.json_response(pumps)

    async def start_pump_handler(self, request: web.Request) -> web.Response:
        """Handle POST /api/pump/start - start the pump."""
        await self.start_pump()
        return web.json_response({'status': 'success', 'state': self.pump_state})

    async def stop_pump_handler(self, request: web.Request) -> web.Response:
        """Handle POST /api/pump/stop - stop the pump."""
        await self.stop_pump()
        return web.json_response({'status': 'success', 'state': self.pump_state})

    async def start_pump(self):
        """Start the pump."""
        if self.pump_state != 'on':
            self.pump_state = 'on'
            self.is_running = True
            log.info("Pump started")
            await self.broadcast_state()

    async def stop_pump(self):
        """Stop the pump."""
        if self.pump_state != 'off':
            self.pump_state = 'off'
            self.is_running = False
            log.info("Pump stopped")
            await self.broadcast_state()

    async def index_handler(self, request: web.Request) -> web.FileResponse:
        """Serve index.html for SPA routing."""
        frontend_dist = Path(__file__).parent / 'frontend' / 'dist'
        index_file = frontend_dist / 'index.html'
        if index_file.exists():
            return web.FileResponse(index_file)
        else:
            return web.Response(text="Frontend not found", status=404)

