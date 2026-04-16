import asyncio
import json
import logging
import time
from pathlib import Path

from pydoover.docker import Application
from pydoover.docker.device_agent.device_agent import DeviceAgentInterface
from pydoover.tags.manager import KeyPath, TagsManagerDocker

from .app_config import SiaTestBenchConfig
from .app_state import SiaTestBenchState
from .pulse_detector import PulseRateDetector
from .server import TestBenchServer
from .utils import PumpType

log = logging.getLogger()

# Test duration constants (in seconds) - change these to adjust test lengths
MAX_PRESSURE_STABILISE_DURATION = 10.0
MAX_PRESSURE_RUN_DURATION = 10.0
MAX_FLOW_STABILISE_DURATION = 10.0
MAX_FLOW_RUN_DURATION = 10.0
FLOW_ACCURACY_STABILISE_DURATION = 10.0
FLOW_ACCURACY_PHASE1_DURATION = 30.0
FLOW_ACCURACY_PHASE2_DURATION = 30.0
FLOW_ACCURACY_PHASE3_DURATION = 30.0


class SiaTestBenchApplication(Application):
    config_cls = SiaTestBenchConfig

    def _safe_config(self, field, fallback=None):
        """Read a config field, returning fallback if not yet set."""
        try:
            return field.value
        except ValueError:
            return fallback

    def get_data_tag(self, tag_key: str, source_app_key: str, default=None):
        """Read a tag from the remote data DDA, or locally if Data DDA is unset."""
        if self.remote_tag_manager is not None:
            return self.remote_tag_manager.get_tag(
                tag_key, default=default, app_key=source_app_key,
            )
        return self.get_tag(tag_key, source_app_key, default=default)

    async def set_data_tag(self, tag_key: str, value, app_key: str, only_if_changed: bool = True):
        """Write a tag to the remote data DDA, or locally if Data DDA is unset.

        For command/write tags (e.g. StateWriteTag), pass only_if_changed=False so
        the write is always published, even if the cached value matches.
        """
        if self.remote_tag_manager is not None:
            await self.remote_tag_manager.set_tag(
                tag_key, value, app_key=app_key, only_if_changed=only_if_changed, flush=True
            )
        else:
            await self.set_tag(tag_key, value, app_key)

    async def setup(self):
        self.started = time.time()
        self.state = None
        self.server = None
        self.previous_data = None
        self.shared_testmode = "off"
        self.max_pressure_stabilise_start_time = None
        self.max_pressure_run_start_time = None
        self.max_flow_stabilise_start_time = None
        self.max_flow_run_start_time = None
        self.flow_accuracy_stabilise_start_time = None
        self.flow_accuracy_phase1_start_time = None
        self.flow_accuracy_phase2_start_time = None
        self.flow_accuracy_phase3_start_time = None
        self.shared_pressure_confirmation = False
        self.shared_flow_confirmation = False
        self.shared_flow_accuracy_confirmation = False
        self.shared_pressure_complete_acknowledged = False
        self.shared_flow_complete_acknowledged = False
        self.shared_flow_accuracy_complete_acknowledged = False
        self.previous_state = None
        self.current_pressure = None
        self.target_max_pressure = None
        self.current_flow = None
        self.target_max_flow = None
        self.target_flow_accuracy = None
        self.flow_accuracy_max_flow_rate = None

        dda_uri = (self._safe_config(self.config.data_dda, "") or "").strip() or None

        self.remote_tag_manager = None
        if dda_uri:
            remote_agent = DeviceAgentInterface(app_key=self.app_key, dda_uri=dda_uri)
            self.remote_tag_manager = TagsManagerDocker(client=remote_agent)
            await self.remote_tag_manager.setup()
            log.info(f"Remote tag manager connected to DDA at {dda_uri}")
            config_agg = await remote_agent.fetch_channel_aggregate("deployment_config")
        else:
            config_agg = await self.device_agent.fetch_channel_aggregate("deployment_config")

        deployment_config = config_agg.data
        pump_controller_key = self._safe_config(self.config.pump_controller_app)
        pump_control_config = deployment_config.get("applications", {}).get(pump_controller_key) if pump_controller_key else None
        if pump_control_config:
            pump_size = pump_control_config.get("pump_size", "").replace("/", "_")
            self.pump_controller_pump = PumpType[pump_size]
            self.pump_max = self.pump_controller_pump.value.get_max_rate()
        else:
            log.warning("Pump controller config not found in deployment config, using defaults")
            self.pump_controller_pump = None
            self.pump_max = 1.0

        pulse_source = self._safe_config(self.config.pulse_source, "flow")

        # Current sensor app keys mapped by supply voltage
        self.current_draw_apps = {
            "24VDC": self._safe_config(self.config.current_draw_24vdc_app),
            "12VDC": self._safe_config(self.config.current_draw_12vdc_app),
            "240VAC": self._safe_config(self.config.current_draw_240vac_app),
        }
        self.active_supply_voltage = None  # Set when a pump is selected

        # Load pumps config for voltage lookup
        pumps_config_path = Path(__file__).parent / "pumps_config.json"
        try:
            with open(pumps_config_path) as f:
                self.pumps_config = json.load(f)
        except Exception as e:
            log.warning(f"Could not load pumps_config.json: {e}")
            self.pumps_config = []

        self.flow_pulse_detector = None
        self.current_draw_pulse_detectors = {}

        flow_app_key = self._safe_config(self.config.flow_meter_sensor_app)

        if pulse_source in ("flow", "both") and flow_app_key:
            self.flow_pulse_detector = PulseRateDetector()
            self.flow_pulse_detector.subscribe(
                self,
                tag_key="value",
                app_key=flow_app_key,
                data_dda_uri=dda_uri,
            )

        if pulse_source in ("current_draw", "both"):
            for voltage, app_key in self.current_draw_apps.items():
                if app_key:
                    detector = PulseRateDetector()
                    detector.subscribe(
                        self,
                        tag_key="value",
                        app_key=app_key,
                        data_dda_uri=dda_uri,
                    )
                    self.current_draw_pulse_detectors[voltage] = detector

        self.state = SiaTestBenchState(app=self)
        self.server = TestBenchServer(state=self.state, app=self)
        await self.server.setup()
        
    def get_active_current_draw_app(self):
        """Return the current draw app key for the active supply voltage."""
        if self.active_supply_voltage:
            return self.current_draw_apps.get(self.active_supply_voltage)
        return None

    def set_active_supply_voltage(self, pump_id: str):
        """Look up the selected pump's supplyVoltage and set it as active."""
        for pump in self.pumps_config:
            if pump.get("id") == pump_id:
                voltage = pump.get("supplyVoltage")
                if voltage:
                    self.active_supply_voltage = voltage
                    log.info(f"Active supply voltage set to {voltage} for pump {pump_id}")
                return
        log.warning(f"Pump {pump_id} not found in pumps_config, supply voltage unchanged")

    async def set_ui_pump_params(self, params):
        self.ui_pump_params = params
        
    async def get_ui_max_flow_rate(self):
        return self.ui_pump_params.get("max_flow_rate")

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
            pressure_app = self._safe_config(self.config.pressure_app)
            tank_app = self._safe_config(self.config.tank_level_app)
            flow_app = self._safe_config(self.config.flow_meter_sensor_app)
            current_app = self.get_active_current_draw_app()
            pump_app = self._safe_config(self.config.pump_controller_app)

            pressure = self.get_data_tag("value", pressure_app) if pressure_app else None
            tank_level = self.get_data_tag("level_filled_percentage", tank_app) if tank_app else None
            flow_rate = self.get_data_tag("value", flow_app) if flow_app else None
            current_draw = self.get_data_tag("value", current_app) if current_app else None
            pump_duty_cycle = self.get_data_tag("PumpDutyCycle_ReadOnly", pump_app) if pump_app else None
            target_pump_duty_cycle = self.get_data_tag("TargetPumpDutyCycle_ReadOnly", pump_app) if pump_app else None
            pump_state = self.get_data_tag("AppState", pump_app) if pump_app else None

            # Normalize pump_state: convert "auto" to "on" for consistency
            if pump_state == "auto":
                pump_state = "on"

            if pump_duty_cycle is not None:
                pump_duty_cycle = round(pump_duty_cycle * 100, 2)

            if target_pump_duty_cycle is not None:
                target_pump_duty_cycle = round(target_pump_duty_cycle * 100, 2)
                
            flow_pulse = self.flow_pulse_detector.pulse_rate if self.flow_pulse_detector else None
            active_cd_detector = self.current_draw_pulse_detectors.get(self.active_supply_voltage) if self.active_supply_voltage else None
            current_draw_pulse = active_cd_detector.pulse_rate if active_cd_detector else None

            if flow_pulse is not None:
                await self.set_tag("flow_pulse", flow_pulse)
            if current_draw_pulse is not None:
                await self.set_tag("current_draw_pulse", current_draw_pulse)

            # Use flow pulse if available, otherwise current draw pulse
            pulse_rate = flow_pulse if flow_pulse is not None else current_draw_pulse
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
            target_pump_duty_cycle = None
            pulse_rate = None
            valve_state = None
            pump_state = None
            self.current_pressure = None
            self.current_flow = None

        # Create current data object for comparison
        current_data = {
            'pressure': pressure,
            'tankLevel': tank_level,
            'flowRate': flow_rate,
            'currentDraw': current_draw,
            'pumpDutyCycle': pump_duty_cycle,
            'targetPumpDutyCycle': target_pump_duty_cycle,
            'pulseRate': pulse_rate,
            'valveState': valve_state,
            'pumpState': pump_state,
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
                'targetPumpDutyCycle': target_pump_duty_cycle,
                'pulseRate': pulse_rate,
                'valveState': valve_state,
                'pumpState': pump_state,
            }

            # Push data to frontend via WebSocket
            await self.server.push_data(data)
            
            # Update previous data for next comparison
            self.previous_data = current_data.copy()
        
        # Sleep for 500ms before next iteration
        await asyncio.sleep(0.5)
    
    async def cleanup(self):
        """Cleanup resources when shutting down."""
        if self.flow_pulse_detector:
            await self.flow_pulse_detector.stop()
        for detector in self.current_draw_pulse_detectors.values():
            await detector.stop()
        if self.server:
            await self.server.cleanup()
            
    async def set_flow_rate(self, flow_rate: float):
        pump_app = self._safe_config(self.config.pump_controller_app)
        ui_max = await self.get_ui_max_flow_rate()
        if ui_max is not None and ui_max > 0 and pump_app:
            duty_cycle_pct = (flow_rate / ui_max) * 100
            await self.set_data_tag("TargetRatePercentageWriteTag", duty_cycle_pct, pump_app, only_if_changed=False)

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
    
    def check_flow_accuracy_verified(self):
        log.info(f"Current pressure: {self.current_pressure}, Target flow accuracy pressure (20% of max): {self.target_flow_accuracy}")
        # Check if current pressure reading meets or exceeds 20% of max pressure
        if self.current_pressure is None or self.target_flow_accuracy is None:
            return False
        return self.current_pressure >= self.target_flow_accuracy
    
    def check_flow_accuracy_stabilised(self):
        # Check if stabilisation duration has elapsed since entering flow_accuracy_stabilise
        if self.flow_accuracy_stabilise_start_time is None:
            return False
        elapsed_time = time.time() - self.flow_accuracy_stabilise_start_time
        return elapsed_time >= FLOW_ACCURACY_STABILISE_DURATION
    
    def check_flow_accuracy_phase1_complete(self):
        # Check if phase 1 duration has elapsed
        if self.flow_accuracy_phase1_start_time is None:
            return False
        elapsed_time = time.time() - self.flow_accuracy_phase1_start_time
        return elapsed_time >= FLOW_ACCURACY_PHASE1_DURATION
    
    def check_flow_accuracy_phase2_complete(self):
        # Check if phase 2 duration has elapsed
        if self.flow_accuracy_phase2_start_time is None:
            return False
        elapsed_time = time.time() - self.flow_accuracy_phase2_start_time
        return elapsed_time >= FLOW_ACCURACY_PHASE2_DURATION
    
    def check_flow_accuracy_phase3_complete(self):
        # Check if phase 3 duration has elapsed
        if self.flow_accuracy_phase3_start_time is None:
            return False
        elapsed_time = time.time() - self.flow_accuracy_phase3_start_time
        return elapsed_time >= FLOW_ACCURACY_PHASE3_DURATION

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
        pump_app = self._safe_config(self.config.pump_controller_app)
        log.info(f"Stopping pump: app_key={pump_app}")
        if pump_app:
            await self.set_data_tag("StateWriteTag", 0, pump_app, only_if_changed=False)
            log.info(f"StateWriteTag=0 written to {pump_app}")
        else:
            log.warning("No pump_controller_app configured, cannot stop pump")

    async def start_pump(self):
        pump_app = self._safe_config(self.config.pump_controller_app)
        log.info(f"Starting pump: app_key={pump_app}")
        if pump_app:
            await self.set_data_tag("StateWriteTag", 2, pump_app, only_if_changed=False)
            log.info(f"StateWriteTag=2 written to {pump_app}")
        else:
            log.warning("No pump_controller_app configured, cannot start pump")

    def clear_shared_testmode(self):
        self.shared_testmode = "off"
        # Reset timers when clearing test mode
        self.max_pressure_stabilise_start_time = None
        self.max_pressure_run_start_time = None
        self.max_flow_stabilise_start_time = None
        self.max_flow_run_start_time = None
        self.flow_accuracy_stabilise_start_time = None
        self.flow_accuracy_phase1_start_time = None
        self.flow_accuracy_phase2_start_time = None
        self.flow_accuracy_phase3_start_time = None
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
        self.target_flow_accuracy = None
        self.flow_accuracy_max_flow_rate = None

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
            
            elif state == "flow_accuracy_end" and self.previous_state == "flow_accuracy_phase3":
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
        
        elif state == "flow_accuracy_stabilise" and self.flow_accuracy_stabilise_start_time is not None:
            elapsed = time.time() - self.flow_accuracy_stabilise_start_time
            progress = min(100.0, (elapsed / FLOW_ACCURACY_STABILISE_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'flow_accuracy_stabilise',
                'progress': progress,
                'elapsed': elapsed,
                'duration': FLOW_ACCURACY_STABILISE_DURATION
            })
        
        elif state == "flow_accuracy_phase1" and self.flow_accuracy_phase1_start_time is not None:
            elapsed = time.time() - self.flow_accuracy_phase1_start_time
            progress = min(100.0, (elapsed / FLOW_ACCURACY_PHASE1_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'flow_accuracy_phase1',
                'progress': progress,
                'elapsed': elapsed,
                'duration': FLOW_ACCURACY_PHASE1_DURATION
            })
        
        elif state == "flow_accuracy_phase2" and self.flow_accuracy_phase2_start_time is not None:
            elapsed = time.time() - self.flow_accuracy_phase2_start_time
            progress = min(100.0, (elapsed / FLOW_ACCURACY_PHASE2_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'flow_accuracy_phase2',
                'progress': progress,
                'elapsed': elapsed,
                'duration': FLOW_ACCURACY_PHASE2_DURATION
            })
        
        elif state == "flow_accuracy_phase3" and self.flow_accuracy_phase3_start_time is not None:
            elapsed = time.time() - self.flow_accuracy_phase3_start_time
            progress = min(100.0, (elapsed / FLOW_ACCURACY_PHASE3_DURATION) * 100.0)
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'flow_accuracy_phase3',
                'progress': progress,
                'elapsed': elapsed,
                'duration': FLOW_ACCURACY_PHASE3_DURATION
            })