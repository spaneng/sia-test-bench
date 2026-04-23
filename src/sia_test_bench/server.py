import asyncio
import collections
import json
import logging
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Set, Optional, Dict

import aiohttp
from aiohttp import web
from aiohttp.web_runner import AppRunner, TCPSite

# Use absolute import so this can be run as a script
from sia_test_bench.app_state import SiaTestBenchState
from sia_test_bench.test_persistence import TestPersistence
from sia_test_bench.test_validation import validate_test_data, compute_test_metrics
from sia_test_bench.reports.test_reports import render_test_chart_png, generate_report_pdf

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
        self.client_ids: Dict[web.WebSocketResponse, str] = {}
        self.selected_pump_id: str | None = None
        self.pump_state: str = 'warning_disabled'
        self.is_running: bool = False
        self.target_flow: float = 0.0
        self.test_persistence = TestPersistence()
        self.data_buffer: collections.deque = collections.deque(maxlen=200)

    async def setup(self):
        """Initialize the web server."""
        # Create aiohttp application with CORS middleware
        self.app = web.Application(middlewares=[cors_middleware])
        
        # Setup API routes first
        self.app.router.add_get('/ws', self.websocket_handler)
        self.app.router.add_get('/api/pumps', self.get_pumps_handler)
        self.app.router.add_post('/api/pump/start', self.start_pump_handler)
        self.app.router.add_post('/api/pump/stop', self.stop_pump_handler)
        self.app.router.add_post('/api/tests/{test_id}/finalize', self.finalize_test_handler)
        self.app.router.add_get('/api/tests/{test_id}/report.pdf', self.get_report_pdf_handler)
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
        # heartbeat keeps the WS alive across NAT/Wi-Fi idle timeouts
        # and lets both sides detect a dead connection quickly.
        ws = web.WebSocketResponse(heartbeat=20.0)
        await ws.prepare(request)

        client_id = str(uuid.uuid4())
        self.websockets.add(ws)
        self.client_ids[ws] = client_id
        log.info(f"WebSocket client connected ({client_id}). Total clients: {len(self.websockets)}")

        # Send session snapshot to the newly connected client
        snapshot = self.build_session_snapshot()
        try:
            await ws.send_str(json.dumps(snapshot))
        except Exception as e:
            log.error(f"Error sending session snapshot to client: {e}")
        
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
            self.client_ids.pop(ws, None)
            log.info(f"WebSocket client disconnected ({client_id}). Total clients: {len(self.websockets)}")
        
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
                # Sync target flow to other clients
                await self.broadcast_to_others(ws, {
                    'type': 'state',
                    'state': self.pump_state,
                    'targetFlow': self.target_flow,
                })
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
                # User clicked Accept on the max_flow_start screen. The new
                # max-flow test has TWO gates during the regulate phase:
                #   - pressure ≥ 30% of the pump's marketed max pressure
                #   - coriolis filtered flow ≥ 97% of the pump's marketed max flow
                if self.application:
                    target_pressure = data.get('target_pressure')
                    max_flow_rate = data.get('max_flow_rate')
                    from .application import MAX_FLOW_PRESSURE_TARGET_PCT, MAX_FLOW_RATE_TARGET_PCT
                    if target_pressure is not None:
                        self.application.target_max_flow_pressure_psi = target_pressure * MAX_FLOW_PRESSURE_TARGET_PCT
                        log.info(
                            f"Flow pressure gate: {self.application.target_max_flow_pressure_psi:.2f} PSI "
                            f"({MAX_FLOW_PRESSURE_TARGET_PCT*100:.0f}% of {target_pressure})"
                        )
                    if max_flow_rate is not None:
                        self.application.flow_accuracy_max_flow_rate = float(max_flow_rate)
                        self.application.target_max_flow_rate_lhr = max_flow_rate * MAX_FLOW_RATE_TARGET_PCT
                        log.info(
                            f"Flow rate gate: {self.application.target_max_flow_rate_lhr:.2f} L/hr "
                            f"({MAX_FLOW_RATE_TARGET_PCT*100:.0f}% of {max_flow_rate})"
                        )
                    self.application.shared_flow_confirmation = True
                    log.info("Flow test confirmation received")
            elif command == 'confirm_flow_valve_closed':
                # User clicked Continue on the sight-glass-valve prompt in max_flow_prep
                if self.application:
                    self.application.shared_flow_valve_closed_confirmation = True
                    log.info("Flow valve-closed confirmation received")
            elif command == 'confirm_flow_accuracy_test':
                # User clicked Accept button for flow accuracy test
                # Calculate 20% of max pressure as target (same as max_flow)
                if self.application:
                    target_pressure = data.get('target_pressure')
                    max_flow_rate = data.get('max_flow_rate')
                    if target_pressure is not None:
                        # Use 20% of max pressure value as target for verification
                        self.application.target_flow_accuracy = target_pressure * 0.2
                        log.info(f"Flow accuracy target set to {self.application.target_flow_accuracy} (20% of {target_pressure})")
                    if max_flow_rate is not None:
                        # Store max flow rate for calculating phase targets (10%, 50%, 100%)
                        self.application.flow_accuracy_max_flow_rate = float(max_flow_rate)
                        log.info(f"Flow accuracy max flow rate set to {max_flow_rate} L/Hr")
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
            if command == 'select_pump':
                pump_id = data.get('pumpId')
                if pump_id:
                    self.selected_pump_id = pump_id
                    log.info(f"Pump selected: {pump_id}")
                    # Set active supply voltage on the application
                    if self.application:
                        self.application.set_active_supply_voltage(pump_id)
                    # Broadcast to all other clients
                    await self.broadcast_to_others(ws, {
                        'type': 'pump_selected',
                        'pumpId': pump_id,
                    })
            elif command == 'set_pump_params':
                # Save pump parameters from UI form
                params = data.get('params', {})
                if self.application:
                    await self.application.set_ui_pump_params(params)
                    # Set active supply voltage from user selection
                    supply_voltage = params.get('supply_voltage')
                    if supply_voltage:
                        self.application.active_supply_voltage = supply_voltage
                        log.info(f"Active supply voltage set to {supply_voltage}")
                    log.info(f"Pump parameters saved: {params}")
                else:
                    log.warning("Application reference not set, cannot save pump parameters")
                # Broadcast params to other clients so they can update editable pump data
                await self.broadcast_to_others(ws, {
                    'type': 'pump_params_updated',
                    'params': params,
                })
            else:
                log.debug(f"Unknown pump command: {command}")
        elif message_type == 'input_activity':
            # Rebroadcast input activity to all other clients
            element_id = data.get('elementId')
            if element_id:
                await self.broadcast_to_others(ws, {
                    'type': 'input_activity',
                    'elementId': element_id,
                })
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
        self.data_buffer.append(data)
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
    
    async def _send_one(self, ws: web.WebSocketResponse, message: str, timeout: float = 2.0):
        # Dropping a slow client is better than blocking the broadcast loop —
        # a stuck send_str() (full TCP buffer on a flaky Wi-Fi link) would
        # otherwise stall every other client and starve the WS heartbeat.
        try:
            await asyncio.wait_for(ws.send_str(message), timeout=timeout)
            return ws, None
        except (asyncio.TimeoutError, ConnectionResetError, Exception) as e:
            return ws, e

    async def _broadcast(self, targets, message: str):
        if not targets:
            return
        results = await asyncio.gather(
            *(self._send_one(ws, message) for ws in targets),
            return_exceptions=False,
        )
        for ws, err in results:
            if err is None:
                continue
            log.warning(f"Dropping WS client {self.client_ids.get(ws, '?')}: {err!r}")
            self.websockets.discard(ws)
            self.client_ids.pop(ws, None)
            try:
                await ws.close()
            except Exception:
                pass

    async def broadcast_data(self, data: dict):
        """Broadcast data to all connected WebSocket clients."""
        await self._broadcast(list(self.websockets), json.dumps(data))

    async def broadcast_to_others(self, sender: web.WebSocketResponse, data: dict):
        """Broadcast data to all connected WebSocket clients except the sender."""
        await self._broadcast(
            [ws for ws in self.websockets if ws is not sender],
            json.dumps(data),
        )

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

    def build_session_snapshot(self) -> dict:
        """Build a snapshot of the current session state for a newly connected client."""
        from sia_test_bench.application import (
            MAX_FLOW_RUN_DURATION,
            FLOW_ACCURACY_STABILISE_DURATION,
            FLOW_ACCURACY_PHASE1_DURATION, FLOW_ACCURACY_PHASE2_DURATION,
            FLOW_ACCURACY_PHASE3_DURATION,
        )

        sm_state = self.state.state if self.state else 'off'
        test_mode = self.application.shared_testmode if self.application else 'off'

        # Compute live progress percentages from timer start times
        progress = {}
        completion = {}
        now = time.time()
        app = self.application

        if app:
            timer_map = {
                'max_flow': (app.max_flow_run_start_time, MAX_FLOW_RUN_DURATION),
                'flow_accuracy_stabilise': (app.flow_accuracy_stabilise_start_time, FLOW_ACCURACY_STABILISE_DURATION),
                'flow_accuracy_phase1': (app.flow_accuracy_phase1_start_time, FLOW_ACCURACY_PHASE1_DURATION),
                'flow_accuracy_phase2': (app.flow_accuracy_phase2_start_time, FLOW_ACCURACY_PHASE2_DURATION),
                'flow_accuracy_phase3': (app.flow_accuracy_phase3_start_time, FLOW_ACCURACY_PHASE3_DURATION),
            }
            for key, (start_time, duration) in timer_map.items():
                if start_time is not None:
                    elapsed = now - start_time
                    progress[key] = min(100.0, (elapsed / duration) * 100.0)

            # Completion flags
            if sm_state == 'max_pressure_end':
                completion['max_pressure'] = True
            if sm_state == 'max_flow_end':
                completion['max_flow'] = True
            if sm_state == 'flow_accuracy_end':
                completion['flow_accuracy'] = True

        # Pump params
        pump_params = None
        if app and hasattr(app, 'ui_pump_params'):
            pump_params = app.ui_pump_params

        # Include current max_pressure_verify stage so reconnecting clients
        # land on the right message instead of the default "checking".
        verify_status = None
        if app and sm_state == 'max_pressure_verify':
            verify_status = app.get_max_pressure_verify_status()

        # Max-flow regulate status for reconnecting clients.
        max_flow_regulate = None
        if app and sm_state == 'max_flow_regulate':
            max_flow_regulate = app.get_max_flow_regulate_status()

        # Prep-phase warning and recorded initial level.
        max_flow_prep = None
        if app and sm_state in ('max_flow_prep', 'max_flow_run'):
            max_flow_prep = {
                'initial_level_m': app.max_flow_initial_level,
                'valve_warning': app.max_flow_valve_warning,
            }

        return {
            'type': 'session_snapshot',
            'pumpState': self.pump_state,
            'targetFlow': self.target_flow,
            'stateMachineState': sm_state,
            'testMode': test_mode,
            'dataHistory': list(self.data_buffer),
            'progress': progress,
            'completion': completion,
            'pumpParams': pump_params,
            'selectedPumpId': self.selected_pump_id,
            'maxPressureVerify': verify_status,
            'maxFlowRegulate': max_flow_regulate,
            'maxFlowPrep': max_flow_prep,
        }

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

    async def finalize_test_handler(self, request: web.Request) -> web.Response:
        """Handle POST /api/tests/{test_id}/finalize - finalize a test and generate report.
        
        Expected payload:
        {
            "series": [
                {"timestamp": 1234567890.0, "pressure": 10.5, "flowRate": 5.2, ...},
                ...
            ],
            "metadata": { ... }  # optional
        }
        
        Returns:
        {
            "status": "success",
            "test_id": "...",
            "report_url": "/api/tests/{test_id}/report.pdf",
            "metrics": { ... }
        }
        """
        test_id = request.match_info.get('test_id')
        if not test_id:
            return web.json_response(
                {'error': 'test_id is required'}, 
                status=400
            )
        
        # IDEMPOTENCY CHECK: Check if test already finalized (early return before expensive operations)
        existing_record = self.test_persistence.load_test_record(test_id)
        if existing_record is not None:
            # Test already finalized, return existing report info
            log.info(f"Test {test_id} already finalized, returning existing record")
            metrics = existing_record.get("metrics", {})
            return web.json_response({
                'status': 'success',
                'test_id': test_id,
                'report_url': f'/api/tests/{test_id}/report.pdf',
                'metrics': metrics,
                'already_finalized': True
            })
        
        # Acquire lock to prevent race conditions during finalization
        lock_file = self.test_persistence.acquire_finalization_lock(test_id)
        if lock_file is None:
            # Lock already held - test may be currently finalizing by another request
            # Check again if it completed while we were waiting
            existing_record = self.test_persistence.load_test_record(test_id)
            if existing_record is not None:
                metrics = existing_record.get("metrics", {})
                return web.json_response({
                    'status': 'success',
                    'test_id': test_id,
                    'report_url': f'/api/tests/{test_id}/report.pdf',
                    'metrics': metrics,
                    'already_finalized': True
                })
            return web.json_response(
                {'error': 'Test is currently being finalized by another request'}, 
                status=409  # Conflict
            )
        
        try:
            # Parse request body
            try:
                payload = await request.json()
            except json.JSONDecodeError as e:
                log.exception(f"Invalid JSON in finalize_test request: {e}")
                return web.json_response(
                    {'error': 'Invalid JSON in request body'}, 
                    status=400
                )
            
            # Validate payload
            try:
                validate_test_data(payload)
            except ValueError as e:
                log.exception(f"Validation error for test {test_id}: {e}")
                return web.json_response(
                    {'error': f'Validation failed: {str(e)}'}, 
                    status=400
                )
            
            # Extract series and metadata
            series = payload["series"]
            metadata = payload.get("metadata", {})
            
            # Compute metrics
            try:
                metrics = compute_test_metrics(series)
            except Exception as e:
                log.exception(f"Error computing metrics for test {test_id}: {e}")
                return web.json_response(
                    {'error': f'Failed to compute metrics: {str(e)}'}, 
                    status=500
                )
            
            # Extract test name and type from test_id (format: "test-type-timestamp")
            test_name = None
            test_type = None
            if test_id and '-' in test_id:
                if test_type_str := test_id.rsplit('-', 1)[0]:
                    test_type = test_type_str.replace('-', '_')
                    test_name_map = {
                        'max-pressure': 'Max Pressure Test',
                        'max-flow': 'Max Flow Test',
                        'flow-accuracy': 'Flow Accuracy Test',
                    }
                    test_name = test_name_map.get(test_type_str, test_type_str.replace('-', ' ').title() + ' Test')
            
            # Generate chart PNG asynchronously with timeout
            try:
                chart_png_bytes = await asyncio.wait_for(
                    asyncio.to_thread(render_test_chart_png, series, test_name),
                    timeout=60.0  # 60 second timeout for chart generation
                )
            except asyncio.TimeoutError:
                log.error(f"Chart generation timeout for test {test_id}")
                return web.json_response(
                    {'error': 'Chart generation timed out'}, 
                    status=504  # Gateway Timeout
                )
            except Exception as e:
                log.exception(f"Error generating chart for test {test_id}: {e}")
                return web.json_response(
                    {'error': f'Failed to generate chart: {str(e)}'}, 
                    status=500
                )
            
            # Create test record
            test_record = {
                'test_id': test_id,
                'test_type': test_type,
                'test_name': test_name,
                'metadata': metadata,
                'series': series,
                'metrics': metrics,
                'generated_at': f"{datetime.utcnow().isoformat()}Z",
            }
            
            # Generate PDF report asynchronously with timeout
            try:
                pdf_bytes = await asyncio.wait_for(
                    asyncio.to_thread(generate_report_pdf, test_record, chart_png_bytes),
                    timeout=120.0  # 120 second timeout for PDF generation
                )
            except asyncio.TimeoutError:
                log.error(f"PDF generation timeout for test {test_id}")
                return web.json_response(
                    {'error': 'PDF generation timed out'}, 
                    status=504  # Gateway Timeout
                )
            except Exception as e:
                log.exception(f"Error generating PDF for test {test_id}: {e}")
                return web.json_response(
                    {'error': f'Failed to generate PDF: {str(e)}'}, 
                    status=500
                )
            
            # Save test record and PDF atomically (with rollback on failure)
            try:
                self.test_persistence.save_test_record_and_pdf_atomic(
                    test_id, test_record, pdf_bytes
                )
            except Exception as e:
                log.exception(f"Error saving test record/PDF for {test_id}: {e}")
                return web.json_response(
                    {'error': f'Failed to save test data: {str(e)}'}, 
                    status=500
                )
            
            log.info(f"Successfully finalized test {test_id}")
            
            # Return success response
            return web.json_response({
                'status': 'success',
                'test_id': test_id,
                'report_url': f'/api/tests/{test_id}/report.pdf',
                'metrics': metrics
            })
            
        except Exception as e:
            log.exception(f"Unexpected error finalizing test {test_id}: {e}")
            return web.json_response(
                {'error': 'Internal server error'}, 
                status=500
            )
        finally:
            # Release lock
            if lock_file is not None:
                try:
                    lock_path = self.test_persistence.get_lock_path(test_id)
                    lock_file.close()
                    if lock_path.exists():
                        lock_path.unlink()
                except Exception as e:
                    log.warning(f"Error releasing lock for test {test_id}: {e}")

    async def get_report_pdf_handler(self, request: web.Request) -> web.Response:
        """Handle GET /api/tests/{test_id}/report.pdf - stream PDF report.
        
        Returns:
            PDF file stream, or 404 if not found
        """
        test_id = request.match_info.get('test_id')
        if not test_id:
            return web.json_response(
                {'error': 'test_id is required'}, 
                status=400
            )
        
        try:
            # Load PDF from disk
            pdf_bytes = self.test_persistence.load_report_pdf(test_id)
            
            if pdf_bytes is None:
                log.warning(f"Report PDF not found for test {test_id}")
                return web.json_response(
                    {'error': 'Report not found'}, 
                    status=404
                )
            
            # Stream PDF response
            return web.Response(
                body=pdf_bytes,
                content_type='application/pdf',
                headers={
                    'Content-Disposition': f'inline; filename="test_report_{test_id}.pdf"'
                }
            )
            
        except Exception as e:
            log.exception(f"Error retrieving PDF report for {test_id}: {e}")
            return web.json_response(
                {'error': 'Internal server error'}, 
                status=500
            )

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
