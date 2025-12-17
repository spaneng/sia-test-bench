import asyncio
import logging
import time

from pydoover.docker import Application

from .app_config import SiaTestBenchConfig
from .app_state import SiaTestBenchState
from .server import TestBenchServer

log = logging.getLogger()


class SiaTestBenchApplication(Application):
    config: SiaTestBenchConfig  # not necessary, but helps your IDE provide autocomplete!

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.started: float = time.time()
        self.state: SiaTestBenchState = None
        self.server: TestBenchServer = None
        self.previous_data: dict = None
        self.shared_testmode = "off"
        self.max_pressure_run_start_time: float = None
        self.max_flow_run_start_time: float = None

    async def setup(self):
        """Initialize the state machine and web server."""
        self.state = SiaTestBenchState(app=self)
        self.server = TestBenchServer(state=self.state, app=self)
        await self.server.setup()

    async def main_loop(self):

        state = await self.state.spin_state()
        
        """Main application loop - called periodically."""
        # Get tag values for system data
        try:
            pressure = self.get_tag("value", self.config.pressure_sensor_app.value)
            tank_level = self.get_tag("level_filled_percentage", self.config.tank_level_app.value)
            flow_rate = self.get_tag("value", self.config.flow_sensor_app.value)
            current_draw = self.get_tag("value", self.config.current_draw_app.value)
            pulse_rate = 10 #self.get_tag("pulse_rate")
            valve_state = False #self.get_tag("valve_state")
        except Exception as e:
            log.error(f"Error getting tag values: {e}")
            # Use None values if tags are not available
            pressure = None
            tank_level = None
            flow_rate = None
            current_draw = None
            pulse_rate = None
            valve_state = None
        
        # Create current data object for comparison
        current_data = {
            'pressure': pressure,
            'tankLevel': tank_level,
            'flowRate': flow_rate,
            'currentDraw': current_draw,
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
    def check_max_pressure_run_ready(self):
        return True
    def check_max_pressure_end_ready(self):
        # Check if 30 seconds have elapsed since entering max_pressure_run
        if self.max_pressure_run_start_time is None:
            return False
        elapsed_time = time.time() - self.max_pressure_run_start_time
        return elapsed_time >= 10.0
    def check_max_flow_start_ready(self):
        return True
    def check_max_flow_run_ready(self):
        return True
    def check_max_flow_end_ready(self):
        # Check if 30 seconds have elapsed since entering max_flow_run
        if self.max_flow_run_start_time is None:
            return False
        elapsed_time = time.time() - self.max_flow_run_start_time
        return elapsed_time >= 10.0


    def clear_shared_testmode(self):
        self.shared_testmode = "off"
        # Reset timers when clearing test mode
        self.max_pressure_run_start_time = None
        self.max_flow_run_start_time = None