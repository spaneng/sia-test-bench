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

    async def setup(self):
        """Initialize the state machine and web server."""
        self.state = SiaTestBenchState()
        self.server = TestBenchServer(state=self.state)
        await self.server.setup()

    async def main_loop(self):
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
