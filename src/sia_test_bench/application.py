import asyncio
import logging
import time
from urllib.parse import non_hierarchical

from pydoover.docker import Application

from .app_config import SiaTestBenchConfig
from .app_state import SiaTestBenchState
from .server import TestBenchServer

log = logging.getLogger()

# Test duration constants (in seconds) - change these to adjust test lengths
MAX_PRESSURE_STABILISE_DURATION = 10.0
MAX_PRESSURE_RUN_DURATION = 10.0
MAX_FLOW_STABILISE_DURATION = 10.0
MAX_FLOW_RUN_DURATION = 10.0
FLOW_ACCURACY_TEST_DURATION = 10.0


class SiaTestBenchApplication(Application):
    config: SiaTestBenchConfig  # not necessary, but helps your IDE provide autocomplete!

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.started: float = time.time()
        self.state: SiaTestBenchState = None
        self.server: TestBenchServer = None
        self.previous_data: dict = None
        self.shared_testmode = "off"
        self.max_pressure_stabilise_start_time: float = None
        self.max_pressure_run_start_time: float = None
        self.max_flow_stabilise_start_time: float = None
        self.max_flow_run_start_time: float = None
        self.flow_accuracy_run_start_time: float = None
        self.shared_pressure_confirmation: bool = False
        self.shared_flow_confirmation: bool = False
        self.shared_flow_accuracy_confirmation: bool = False
        self.shared_pressure_complete_acknowledged: bool = False
        self.shared_flow_complete_acknowledged: bool = False
        self.shared_flow_accuracy_complete_acknowledged: bool = False
        self.previous_state: str = None
        self.current_pressure: float = None
        self.target_max_pressure: float = None
        self.current_flow: float = None
        self.target_max_flow: float = None

    async def setup(self):
        """Initialize the state machine and web server."""
        self.state = SiaTestBenchState(app=self)
        self.server = TestBenchServer(state=self.state, app=self)
        await self.server.setup()

    async def main_loop(self):

        state = await self.state.spin_state()
        
        """Main application loop - called periodically."""
        
        # Push current state machine state to frontend
        await self.server.push_state_machine_state(state)
        
        # Check for state changes and notify frontend
        await self.check_state_changes(state)
        
        # Send test progress updates if in a test run state
        await self.send_test_progress_updates(state)
        
        # Get tag values for system data
        try:
            pressure = self.get_tag("value", self.config.pressure_sensor_app.value)
            tank_level = self.get_tag("level_filled_percentage", self.config.tank_level_app.value)
            flow_rate = self.get_tag("value", self.config.flow_sensor_app.value)
            current_draw = self.get_tag("value", self.config.current_draw_app.value)
            pump_duty_cycle = self.get_tag("PumpDutyCycle_ReadOnly", self.config.pump_controller.value)
            
            if pump_duty_cycle is not None:
                pump_duty_cycle = round(pump_duty_cycle * 100, 2)
                
            pulse_rate = 10 #self.get_tag("pulse_rate")
            valve_state = False #self.get_tag("valve_state")
            
            # Store current pressure and flow for verification checks
            self.current_pressure = pressure
            self.current_flow = flow_rate
        except Exception as e:
            log.error(f"Error getting tag values: {e}")
            # Use None values if tags are not available
            pressure = None
            tank_level = None
            flow_rate = None
            current_draw = None
            pump_duty_cycle = None
            pulse_rate = None
            valve_state = None
            self.current_pressure = None
            self.current_flow = None
        
        # Create current data object for comparison
        current_data = {
            'pressure': pressure,
            'tankLevel': tank_level,
            'flowRate': flow_rate,
            'currentDraw': current_draw,
            'pumpDutyCycle': pump_duty_cycle,
            'pulseRate': pulse_rate,
            'valveState': valve_state,
        }
        
        # Check if data has changed from previous reading
        # Compare each value, handling None values properly
        data_changed = False
        if self.previous_data is None:
            data_changed = True
        else:
            for key in current_data:
                prev_val = self.previous_data.get(key)
                curr_val = current_data[key]
                # Handle None comparisons and value changes
                if prev_val != curr_val:
                    data_changed = True
                    break
        
        if data_changed:
            # Data has changed, prepare and push to frontend
            data = {
                'type': 'data',
                'timestamp': int(time.time() * 1000),
                'pressure': pressure,
                'tankLevel': tank_level,
                'flowRate': flow_rate,
                'currentDraw': current_draw,
                'pumpDutyCycle': pump_duty_cycle,
                'pulseRate': pulse_rate,
                'valveState': valve_state,
            }
            
            # Push data to frontend via WebSocket
            await self.server.push_data(data)
            
            # Update previous data for next comparison
            self.previous_data = current_data.copy()
        
        # Sleep for 500ms before next iteration
        await asyncio.sleep(0.5)
    
    async def cleanup(self):
        """Cleanup resources when shutting down."""
        if self.server:
            await self.server.cleanup()
            
    async def set_flow_rate(self, flow_rate: float):
        await self.set_tag("TargetRate",flow_rate, self.config.pump_controller.value)

    def check_off_command(self):
        return False
    def check_auto_command(self):
        if self.shared_testmode == "auto":
            return True
        else:
            return False
    def check_auto_ready(self):
        return True
    def check_max_pressure_command(self):
        if self.shared_testmode == "max_pressure":
            return True
        else:
            return False
    def check_max_pressure_end_ready(self):
        return True
    def check_max_flow_command(self):
        if self.shared_testmode == "max_flow":
            return True
        else:
            return False
    def check_flow_accuracy_command(self):
        if self.shared_testmode == "flow_accuracy":
            return True
        else:
            return False
    def check_max_pressure_run_ready(self):
        return self.shared_pressure_confirmation
    def check_max_pressure_verified(self):
        # Check if current pressure reading meets or exceeds target pressure
        if self.current_pressure is None or self.target_max_pressure is None:
            return False
        return self.current_pressure >= self.target_max_pressure

    def check_max_pressure_stabilised(self):
        # Check if stabilisation duration has elapsed since entering max_pressure_stabilise
        if self.max_pressure_stabilise_start_time is None:
            return False
        elapsed_time = time.time() - self.max_pressure_stabilise_start_time
        return elapsed_time >= MAX_PRESSURE_STABILISE_DURATION

    def check_max_pressure_end_ready(self):
        # Check if test run duration has elapsed since entering max_pressure_run
        if self.max_pressure_run_start_time is None:
            return False
        elapsed_time = time.time() - self.max_pressure_run_start_time
        return elapsed_time >= MAX_PRESSURE_RUN_DURATION
    def check_max_flow_start_ready(self):
        return True
    
    def check_max_flow_run_ready(self):
        return self.shared_flow_confirmation
    
    def check_max_flow_verified(self):
        log.info(f"Current pressure: {self.current_pressure}, Target flow pressure (20% of max): {self.target_max_flow}")
        # Check if current pressure reading meets or exceeds 20% of max pressure
        if self.current_pressure is None or self.target_max_flow is None:
            return False
        return self.current_pressure >= self.target_max_flow
    
    def check_max_flow_stabilised(self):
        # Check if stabilisation duration has elapsed since entering max_flow_stabilise
        if self.max_flow_stabilise_start_time is None:
            return False
        elapsed_time = time.time() - self.max_flow_stabilise_start_time
        return elapsed_time >= MAX_FLOW_STABILISE_DURATION
    
    def check_max_flow_end_ready(self):
        # Check if test run duration has elapsed since entering max_flow_run
        if self.max_flow_run_start_time is None:
            return False
        elapsed_time = time.time() - self.max_flow_run_start_time
        return elapsed_time >= MAX_FLOW_RUN_DURATION
    
    def check_flow_accuracy_run_ready(self):
        return self.shared_flow_accuracy_confirmation
    
    def check_flow_accuracy_end_ready(self):
        # Check if test duration has elapsed since entering flow_accuracy_run
        if self.flow_accuracy_run_start_time is None:
            return False
        elapsed_time = time.time() - self.flow_accuracy_run_start_time
        return elapsed_time >= FLOW_ACCURACY_TEST_DURATION

    def check_max_pressure_complete(self):
        # Check if frontend has acknowledged the pressure test completion
        return self.shared_pressure_complete_acknowledged

    def check_max_flow_complete(self):
        # Check if frontend has acknowledged the flow test completion
        return self.shared_flow_complete_acknowledged
    
    def check_flow_accuracy_complete(self):
        # Check if frontend has acknowledged the flow accuracy test completion
        return self.shared_flow_accuracy_complete_acknowledged

    async def stop_pump(self):
        log.info("Stopping pump")
        await self.set_tag("StateControlTag",0, self.config.pump_controller.value)

    async def start_pump(self):
        log.info("Starting pump")
        await self.set_tag("StateControlTag",2, self.config.pump_controller.value)

    def clear_shared_testmode(self):
        self.shared_testmode = "off"
        # Reset timers when clearing test mode
        self.max_pressure_stabilise_start_time = None
        self.max_pressure_run_start_time = None
        self.max_flow_stabilise_start_time = None
        self.max_flow_run_start_time = None
        self.flow_accuracy_run_start_time = None
        # Reset confirmation flags
        self.shared_pressure_confirmation = False
        self.shared_flow_confirmation = False
        self.shared_flow_accuracy_confirmation = False
        # Reset completion acknowledgment flags
        self.shared_pressure_complete_acknowledged = False
        self.shared_flow_complete_acknowledged = False
        self.shared_flow_accuracy_complete_acknowledged = False
        # Reset target pressure and flow
        self.target_max_pressure = None
        self.target_max_flow = None

    async def check_state_changes(self, state: str):
        """Detect state changes and notify frontend of important transitions."""
        if state != self.previous_state:
            log.info(f"State changed from {self.previous_state} to {state}")
            
            # Notify frontend when tests complete
            if state == "max_pressure_end" and self.previous_state == "max_pressure_run":
                await self.server.push_test_complete({
                    'type': 'test_complete',
                    'test': 'max_pressure'
                })
                log.info("Max pressure test completed - notifying frontend")
                # Reset the acknowledgment flag for next test
                self.shared_pressure_complete_acknowledged = False
            
            elif state == "max_flow_end" and self.previous_state == "max_flow_run":
                await self.server.push_test_complete({
                    'type': 'test_complete',
                    'test': 'max_flow'
                })
                log.info("Max flow test completed - notifying frontend")
                # Reset the acknowledgment flag for next test
                self.shared_flow_complete_acknowledged = False
            
            elif state == "flow_accuracy_end" and self.previous_state == "flow_accuracy_run":
                await self.server.push_test_complete({
                    'type': 'test_complete',
                    'test': 'flow_accuracy'
                })
                log.info("Flow accuracy test completed - notifying frontend")
                # Reset the acknowledgment flag for next test
                self.shared_flow_accuracy_complete_acknowledged = False
            
            self.previous_state = state

    async def send_test_progress_updates(self, state: str):
        """Send progress updates for currently running tests."""
        
        if state == "max_pressure_stabilise" and self.max_pressure_stabilise_start_time is not None:
            elapsed = time.time() - self.max_pressure_stabilise_start_time
            progress = min(100.0, (elapsed / MAX_PRESSURE_STABILISE_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_pressure_stabilise',
                'progress': progress,
                'elapsed': elapsed,
                'duration': MAX_PRESSURE_STABILISE_DURATION
            })
        
        elif state == "max_pressure_run" and self.max_pressure_run_start_time is not None:
            elapsed = time.time() - self.max_pressure_run_start_time
            progress = min(100.0, (elapsed / MAX_PRESSURE_RUN_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_pressure',
                'progress': progress,
                'elapsed': elapsed,
                'duration': MAX_PRESSURE_RUN_DURATION
            })
        
        elif state == "max_flow_stabilise" and self.max_flow_stabilise_start_time is not None:
            elapsed = time.time() - self.max_flow_stabilise_start_time
            progress = min(100.0, (elapsed / MAX_FLOW_STABILISE_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_flow_stabilise',
                'progress': progress,
                'elapsed': elapsed,
                'duration': MAX_FLOW_STABILISE_DURATION
            })
        
        elif state == "max_flow_run" and self.max_flow_run_start_time is not None:
            elapsed = time.time() - self.max_flow_run_start_time
            progress = min(100.0, (elapsed / MAX_FLOW_RUN_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_flow',
                'progress': progress,
                'elapsed': elapsed,
                'duration': MAX_FLOW_RUN_DURATION
            })
        
        elif state == "flow_accuracy_run" and self.flow_accuracy_run_start_time is not None:
            elapsed = time.time() - self.flow_accuracy_run_start_time
            progress = min(100.0, (elapsed / FLOW_ACCURACY_TEST_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'flow_accuracy',
                'progress': progress,
                'elapsed': elapsed,
                'duration': FLOW_ACCURACY_TEST_DURATION
            })