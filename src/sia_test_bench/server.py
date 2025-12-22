import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Set

import aiohttp
from aiohttp import web
from aiohttp.web_runner import AppRunner, TCPSite

# Use absolute import so this can be run as a script
from sia_test_bench.app_state import SiaTestBenchState

log = logging.getLogger()


@web.middleware
async def cors_middleware(request: web.Request, handler):
    """CORS middleware to allow cross-origin requests."""
    # Handle preflight OPTIONS requests
    if request.method == 'OPTIONS':
        response = web.Response()
    else:
        response = await handler(request)
    
    # Add CORS headers to all responses
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Max-Age'] = '3600'
    
    return response

class TestBenchServer:
    """Web server for the SIA Test Bench application."""
    
    def __init__(self, state: SiaTestBenchState = None, app = None):
        self.state = state or SiaTestBenchState()
        self.application = app  # Reference to SiaTestBenchApplication
        self.app: web.Application = None
        self.runner: AppRunner = None
        self.site: TCPSite = None
        self.websockets: Set[web.WebSocketResponse] = set()
        self.pump_state: str = 'warning_disabled'
        self.is_running: bool = False
        self.target_flow: float = 0.0

    async def setup(self):
        """Initialize the web server."""
         # Create aiohttp application with CORS middleware
        self.app = web.Application(middlewares=[cors_middleware])
        
        # Setup API routes first
        self.app.router.add_get('/ws', self.websocket_handler)
        self.app.router.add_get('/api/pumps', self.get_pumps_handler)
        self.app.router.add_post('/api/pump/start', self.start_pump_handler)
        self.app.router.add_post('/api/pump/stop', self.stop_pump_handler)
        # Add OPTIONS handler for CORS preflight
        self.app.router.add_options('/api/pump/start', self.options_handler)
        self.app.router.add_options('/api/pump/stop', self.options_handler)
        
        # Serve static files from frontend dist directory
        frontend_dist = Path(__file__).parent / 'frontend' / 'dist'
        if frontend_dist.exists():
            # Serve static assets (JS, CSS, etc.) from /assets/ path
            assets_dir = frontend_dist / 'assets'
            if assets_dir.exists():
                self.app.router.add_static('/assets', assets_dir, name='assets')
            
            # Serve index.html at root
            self.app.router.add_get('/', self.index_handler)
            
            # Catch-all route to serve index.html for SPA routing (must be last)
            # This will also handle any other static files that aren't in /assets/
            self.app.router.add_get('/{path:.*}', self.static_or_index_handler)
        else:
            log.warning(f"Frontend dist directory not found at {frontend_dist}")
        
        # Start the web server
        self.runner = AppRunner(self.app)
        await self.runner.setup()
        
        # Get port from environment or use default
        port = int(os.environ.get('PORT', '8092'))
        self.site = TCPSite(self.runner, '0.0.0.0', port)
        await self.site.start()
        
        log.info(f"Web server started on port {port}")

    async def main_loop(self):
        """Main server loop."""
        # The server runs in the background, so we just sleep here
        await asyncio.sleep(1)
    
    async def cleanup(self):
        """Cleanup resources when shutting down."""
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
                flow_rate = float(data.get('value', 0))
                self.target_flow = flow_rate
                log.info(f"Target flow set to {self.target_flow} L/Hr")
                # Call the application's set_flow_rate method
                if self.application:
                    await self.application.set_flow_rate(flow_rate)
                else:
                    log.warning("Application reference not set, cannot set flow rate")
        elif message_type == 'test':
            # Handle test mode commands
            command = data.get('command')
            if command == 'set_test_mode':
                test_mode = data.get('mode')
                if test_mode in ['auto', 'max_pressure', 'max_flow', 'flow_accuracy', 'off']:
                    if self.application:
                        self.application.shared_testmode = test_mode
                        log.info(f"Test mode set to: {test_mode}")
                    else:
                        log.error("Application reference not set in server")
                else:
                    log.warning(f"Invalid test mode: {test_mode}")
            elif command == 'confirm_pressure_test':
                # User clicked Accept button for pressure test
                if self.application:
                    self.application.shared_pressure_confirmation = True
                    # Store target pressure if provided
                    target_pressure = data.get('target_pressure')
                    if target_pressure is not None:
                        self.application.target_max_pressure = float(target_pressure)
                        log.info(f"Pressure test confirmation received with target: {target_pressure} PSI")
                    else:
                        log.info("Pressure test confirmation received (no target pressure specified)")
            elif command == 'confirm_flow_test':
                # User clicked Accept button for flow test
                # Calculate 20% of max pressure as target flow
                if self.application:
                    target_pressure = data.get('target_pressure')
                    if target_pressure is not None:
                        # Use 20% of max pressure value as target flow
                        self.application.target_max_flow = target_pressure * 0.2
                        log.info(f"Flow test target set to {self.application.target_max_flow} (20% of {target_pressure})")
                    self.application.shared_flow_confirmation = True
                    log.info("Flow test confirmation received")
            elif command == 'confirm_flow_accuracy_test':
                # User clicked Accept button for flow accuracy test
                # Calculate 20% of max pressure as target (same as max_flow)
                if self.application:
                    target_pressure = data.get('target_pressure')
                    if target_pressure is not None:
                        # Use 20% of max pressure value as target
                        self.application.target_flow_accuracy = target_pressure * 0.2
                        log.info(f"Flow accuracy target set to {self.application.target_flow_accuracy} (20% of {target_pressure})")
                    self.application.shared_flow_accuracy_confirmation = True
                    log.info("Flow accuracy test confirmation received")
            elif command == 'acknowledge_pressure_complete':
                # Frontend finished showing pressure test completion message
                if self.application:
                    self.application.shared_pressure_complete_acknowledged = True
                    log.info("Pressure test completion acknowledged by frontend")
            elif command == 'acknowledge_flow_complete':
                # Frontend finished showing flow test completion message
                if self.application:
                    self.application.shared_flow_complete_acknowledged = True
                    log.info("Flow test completion acknowledged by frontend")
            elif command == 'acknowledge_flow_accuracy_complete':
                # Frontend finished showing flow accuracy test completion message
                if self.application:
                    self.application.shared_flow_accuracy_complete_acknowledged = True
                    log.info("Flow accuracy test completion acknowledged by frontend")
            elif command == 'cancel_test':
                # Cancel current test
                if self.application:
                    self.application.shared_testmode = "off"
                    # Trigger state machine to transition to off state
                    if self.state:
                        await self.state.set_off()
                    log.info("Test cancelled, mode set to: off")
            else:
                log.debug(f"Unknown test command: {command}")
        elif message_type == 'pump':
            # Handle pump-related commands
            command = data.get('command')
            if command == 'set_pump_params':
                # Save pump parameters from UI form
                params = data.get('params', {})
                if self.application:
                    await self.application.set_ui_pump_params(params)
                    log.info(f"Pump parameters saved: {params}")
                else:
                    log.warning("Application reference not set, cannot save pump parameters")
            else:
                log.debug(f"Unknown pump command: {command}")
        elif message_type == 'get_state':
            # Send current state
            await self.send_state_to_client(ws)
        else:
            log.debug(f"Unknown message type: {message_type}")


    async def push_data(self, data: dict):
        """Push a data packet to the frontend via WebSocket.
        
        Args:
            data: Dictionary containing the data packet. Should include 'type': 'data'
                  and fields like 'timestamp', 'pressure', 'flowRate', etc.
        """
        await self.broadcast_data(data)
    
    async def push_test_progress(self, data: dict):
        """Push test progress updates to the frontend via WebSocket.
        
        Args:
            data: Dictionary containing test progress. Should include 'type': 'test_progress',
                  'test': 'max_pressure' or 'max_flow', 'progress': 0-100, etc.
        """
        await self.broadcast_data(data)
    
    async def push_test_complete(self, data: dict):
        """Push test completion notification to the frontend via WebSocket.
        
        Args:
            data: Dictionary containing test completion. Should include 'type': 'test_complete',
                  'test': 'max_pressure' or 'max_flow'.
        """
        await self.broadcast_data(data)
    
    async def push_state_machine_state(self, state: str):
        """Push the current state machine state to the frontend via WebSocket.
        
        Args:
            state: The current state machine state (e.g., 'off', 'max_pressure_start', 'max_pressure_run', etc.)
        """
        await self.broadcast_data({
            'type': 'state_machine',
            'state': state
        })
    
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
            'state': self.pump_state,
            'targetFlow': self.target_flow
        })

    async def send_state_to_client(self, ws: web.WebSocketResponse):
        """Send current state to a specific client."""
        try:
            await ws.send_str(json.dumps({
                'type': 'state',
                'state': self.pump_state,
                'targetFlow': self.target_flow
            }))
        except Exception as e:
            log.error(f"Error sending state to client: {e}")

    async def get_pumps_handler(self, request: web.Request) -> web.Response:
        """Handle GET /api/pumps - return available pump types."""
        pumps_config_path = Path(__file__).parent / 'pumps_config.json'
        try:
            with open(pumps_config_path, 'r') as f:
                pumps = json.load(f)
        except FileNotFoundError:
            log.error(f"Pumps config file not found at {pumps_config_path}")
            return web.Response(text="Pumps configuration not found", status=500)
        except json.JSONDecodeError as e:
            log.error(f"Error parsing pumps config: {e}")
            return web.Response(text="Invalid pumps configuration", status=500)
        
        return web.json_response(pumps)

    async def options_handler(self, request: web.Request) -> web.Response:
        """Handle OPTIONS requests for CORS preflight."""
        return web.Response()
    
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
        if self.application:
            try:
                await self.application.start_pump()
            except Exception as e:
                log.error(f"Error calling application.start_pump(): {e}", exc_info=True)
        else:
            log.warning("Application reference not set, cannot start pump")
        # if self.pump_state != 'on':
        #     self.pump_state = 'on'
        #     self.is_running = True
        #     log.info("Pump started")
        #     await self.broadcast_state()

    async def stop_pump(self):
        """Stop the pump."""
        if self.application:
            try:
                await self.application.stop_pump()
            except Exception as e:
                log.error(f"Error calling application.stop_pump(): {e}", exc_info=True)
        else:
            log.warning("Application reference not set, cannot stop pump")
        # if self.pump_state != 'off':
        #     self.pump_state = 'off'
        #     self.is_running = False
        #     log.info("Pump stopped")
        #     await self.broadcast_state()

    async def index_handler(self, request: web.Request) -> web.FileResponse:
        """Serve index.html for root path."""
        frontend_dist = Path(__file__).parent / 'frontend' / 'dist'
        index_file = frontend_dist / 'index.html'
        if index_file.exists():
            return web.FileResponse(index_file)
        else:
            return web.Response(text="Frontend not found", status=404)
    
    async def static_or_index_handler(self, request: web.Request) -> web.Response:
        """Serve static files if they exist, otherwise serve index.html for SPA routing."""
        path = request.match_info.get('path', '')
        
        # Check if the path is a file in the dist directory (but not in assets, which is handled separately)
        frontend_dist = Path(__file__).parent / 'frontend' / 'dist'
        static_file = frontend_dist / path
        
        # Only serve files that exist and are actual files (not directories)
        if static_file.exists() and static_file.is_file() and not path.startswith('assets/'):
            return web.FileResponse(static_file)
        
        # Otherwise, serve index.html for SPA routing
        index_file = frontend_dist / 'index.html'
        if index_file.exists():
            return web.FileResponse(index_file)
        else:
            return web.Response(text="Frontend not found", status=404)


async def main():
    """Main entry point for standalone server."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    server = TestBenchServer()
    
    try:
        log.info("Starting TestBench Server...")
        await server.setup()
        log.info("Server is running. Press Ctrl+C to stop.")
        
        # Keep the server running
        while True:
            await server.main_loop()
            
    except KeyboardInterrupt:
        log.info("Keyboard interrupt received")
    finally:
        log.info("Cleaning up...")
        await server.cleanup()
        log.info("Server stopped")


if __name__ == "__main__":
    asyncio.run(main())
