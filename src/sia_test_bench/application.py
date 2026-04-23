import collections
import json
import logging
import time
from pathlib import Path

from pydoover.docker import Application
from pydoover.docker.device_agent.device_agent import DeviceAgentInterface
from pydoover.tags.manager import KeyPath, TagsManagerDocker

from .app_config import SiaTestBenchConfig
from .app_state import SiaTestBenchState
from .pulse_detector import PulseRateDetector, fuse_pulse_rates
from .server import TestBenchServer
from .utils import PumpType

log = logging.getLogger()

# Test duration constants (in seconds) - change these to adjust test lengths
# Max-pressure verify stage thresholds
# Stage 1 -> 2: pressure must grow by this fraction of target from baseline
MAX_PRESSURE_BUILD_THRESHOLD_PCT = 0.10
# Stage 2 -> 3: pressure must reach this fraction of the target max pressure
MAX_PRESSURE_TARGET_HOLD_PCT = 0.99
# PSI tolerance used when tracking peak pressure for display (ignores sensor noise)
MAX_PRESSURE_STABILISE_TOLERANCE_PSI = 2.0
# After this long without reaching Stage 2, show a "is the pump bled?" warning
MAX_PRESSURE_BUILD_WARNING_TIME = 120.0
# After this long in Stage 2 without hitting target, show a "still building" warning
MAX_PRESSURE_STAGE2_WARNING_TIME = 30.0
# Stage 3 hold duration — how long pressure must be held at target before verify passes
# (also defines the window of data captured for the report chart).
MAX_PRESSURE_STAGE3_DURATION = 60.0
# Max-flow test: operator dials the regulator until pressure is ~10% of max
# AND the coriolis filtered flow reaches the flow-rate gate. Both conditions
# must be held continuously for MAX_FLOW_REGULATE_HOLD_SECONDS to guard
# against momentary crossings.
MAX_FLOW_PRESSURE_TARGET_PCT = 0.10
# Pressure must be within ± this fraction of the *marketed max pressure*
# of the target set-point. Scaled against max (not target) so the acceptable
# band doesn't shrink when the target itself is a small fraction of max.
MAX_FLOW_PRESSURE_TOLERANCE_PCT = 0.03
MAX_FLOW_RATE_TARGET_PCT = 0.80
# Tank level must be at least this high before the 60s run starts, so the
# test isn't run against a near-empty sight glass.
MAX_FLOW_TANK_LEVEL_MIN_MM = 800.0
MAX_FLOW_REGULATE_HOLD_SECONDS = 3.0
# After pump-start in the run phase, wait this long before checking that the
# sight-glass level is actually dropping. Too short and pump startup masks it.
MAX_FLOW_DROP_CHECK_DELAY = 10.0
# Drop-check tolerance: accept the valve as closed if actual drop is at least
# this fraction of the theoretical drop given max flow rate × area × duration.
MAX_FLOW_DROP_CHECK_TOLERANCE_FRACTION = 0.50
MAX_FLOW_RUN_DURATION = 60.0
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
        # Drive main_loop at 5 Hz for snappier live plot updates
        # (pydoover default is 1 Hz)
        self.loop_target_period = 0.2
        self.state = None
        self.server = None
        self.previous_data = None
        self.shared_testmode = "off"
        # Max-pressure verify 3-stage tracking
        self.max_pressure_verify_start_time = None
        self.max_pressure_verify_baseline = None
        self.max_pressure_peak = None
        self.max_pressure_peak_update_time = None
        self.max_pressure_verify_stage = 'checking'
        self.max_pressure_stage2_start_time = None
        self.max_pressure_stage3_start_time = None
        self.max_pressure_stage3_end_time = None
        # Max-flow test tracking (new 3-phase sequence: regulate -> prep -> run)
        self.max_flow_regulate_settled_start = None
        self.max_flow_run_start_time = None
        self.max_flow_initial_level = None
        self.max_flow_final_level = None
        self.max_flow_drop_check_passed = False
        self.max_flow_valve_warning = False
        # (timestamp, level_m) samples collected during the 60s run — used for
        # the report chart and the final flow calculation.
        self.max_flow_level_history = []
        self.max_flow_flow_rate_lhr = None
        self.sight_glass_area_m2 = None
        self.flow_accuracy_stabilise_start_time = None
        self.flow_accuracy_phase1_start_time = None
        self.flow_accuracy_phase2_start_time = None
        self.flow_accuracy_phase3_start_time = None
        self.shared_pressure_confirmation = False
        self.shared_flow_confirmation = False
        self.shared_flow_valve_closed_confirmation = False
        self.shared_flow_accuracy_confirmation = False
        self.shared_pressure_complete_acknowledged = False
        self.shared_flow_complete_acknowledged = False
        self.shared_flow_accuracy_complete_acknowledged = False
        self.previous_state = None
        self.current_pressure = None
        self.target_max_pressure = None
        self.current_flow = None
        # target_max_flow_pressure_psi = pressure at 10% of max (operator gate)
        # target_max_flow_pressure_tolerance_psi = ±3% of max pressure
        # target_max_flow_rate_lhr = coriolis flow threshold (80% of max)
        self.target_max_flow_pressure_psi = None
        self.target_max_flow_pressure_tolerance_psi = None
        self.target_max_flow_rate_lhr = None
        self.current_level_reading = None
        # Raw (unfiltered) coriolis flow — shown live on the regulate tile.
        self.current_flow_unfiltered = None
        # Trailing 50-sample MA of the unfiltered flow — used by the regulate
        # *gate* so the threshold doesn't flap with noise. Display intentionally
        # keeps the raw value so the operator sees instantaneous behaviour.
        self._flow_ma_buffer: collections.deque = collections.deque(maxlen=50)
        self.current_flow_ma = None
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

        # Sight-glass area for the max-flow test. Read from the SIA injection
        # controller's calibration_gauge_area (units: m^2). If injection_controller_app
        # isn't configured, fall back to pump_controller_app — in most test-bench
        # setups the pump controller IS the injection controller.
        #
        # Doover serialises the config field using the human-readable *label* as
        # the key (e.g. "calibration_gauge_area_(cm^2)" or "..._(m^2)"), so we
        # look for any key that starts with "calibration_gauge_area" instead of
        # matching the Python attribute name exactly.
        injection_key = (
            self._safe_config(self.config.injection_controller_app)
            or pump_controller_key
        )
        injection_cfg = (
            deployment_config.get("applications", {}).get(injection_key)
            if injection_key else None
        )
        area_value = None
        if injection_cfg:
            for k, v in injection_cfg.items():
                if k.startswith("calibration_gauge_area") and v is not None:
                    area_value = v
                    log.info(f"Sight glass area config key matched: {k!r} = {v}")
                    break
        if area_value is not None:
            self.sight_glass_area_m2 = float(area_value)
            log.info(f"Sight glass area loaded from {injection_key}: {self.sight_glass_area_m2} m^2")
        else:
            log.warning(
                f"calibration_gauge_area not found on injection controller "
                f"(tried: {injection_key or 'none'}) — max-flow test will be unavailable"
            )
            self.sight_glass_area_m2 = None

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

        # Gate all pulse detectors on the pump's DutyCycleOutputState so they
        # don't try to find a frequency during the off-phase of a duty cycle.
        pump_app_key = self._safe_config(self.config.pump_controller_app)
        if pump_app_key:
            if self.remote_tag_manager is not None:
                self.remote_tag_manager.subscribe_to_tag(
                    "DutyCycleOutputState",
                    self._on_duty_cycle_state_change,
                    app_key=pump_app_key,
                )
            else:
                self.subscribe_to_tag(
                    "DutyCycleOutputState",
                    self._on_duty_cycle_state_change,
                    app_key=pump_app_key,
                )
            # Apply current state immediately — tag subscriptions only fire on
            # change, so without this we'd be in the default (running) state
            # even if the pump is currently mid off-phase.
            initial_state = self.get_data_tag("DutyCycleOutputState", pump_app_key)
            if initial_state is not None:
                self._on_duty_cycle_state_change("DutyCycleOutputState", initial_state)

        self.state = SiaTestBenchState(app=self)
        self.server = TestBenchServer(state=self.state, app=self)
        await self.server.setup()

    def _iter_pulse_detectors(self):
        if self.flow_pulse_detector is not None:
            yield self.flow_pulse_detector
        yield from self.current_draw_pulse_detectors.values()

    def _on_duty_cycle_state_change(self, key, value):
        """Pause/resume pulse detectors based on the pump's duty-cycle output."""
        if value is None:
            return
        if isinstance(value, str):
            on = value.strip().lower() in ("1", "true", "high", "on", "yes")
        else:
            on = bool(value)
        for detector in self._iter_pulse_detectors():
            if on:
                detector.resume()
            else:
                detector.pause()
        
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

    async def _update_pulse_sensor_polling(self):
        """Drive sensor `polling_frequency` tags for pulse-rate detection.

        Active sensors (flow meter whenever a session is open; current sensor
        matching the active supply voltage) run at 7 Hz so the PulseRateDetector
        has enough Nyquist headroom above the ~1.3 Hz pump pulse rate. Others
        idle at 0.5 Hz.
        """
        session_active = bool(self.server and self.server.websockets)
        active_freq = 7.0
        idle_freq = 2.0

        for voltage, app_key in self.current_draw_apps.items():
            if not app_key:
                continue
            freq = active_freq if (session_active and voltage == self.active_supply_voltage) else idle_freq
            try:
                await self.set_data_tag("polling_frequency", freq, app_key)
            except Exception as e:
                log.warning(f"Failed to set polling_frequency on {voltage} sensor ({app_key}): {e}")

        flow_app_key = self._safe_config(self.config.flow_meter_sensor_app)
        if flow_app_key:
            freq = active_freq if session_active else idle_freq
            try:
                await self.set_data_tag("polling_frequency", freq, flow_app_key)
            except Exception as e:
                log.warning(f"Failed to set polling_frequency on flow sensor ({flow_app_key}): {e}")

    async def main_loop(self):

        state = await self.state.spin_state()

        """Main application loop - called periodically."""

        # Push current state machine state to frontend
        await self.server.push_state_machine_state(state)

        # Check for state changes and notify frontend
        await self.check_state_changes(state)

        # Send test progress updates if in a test run state
        await self.send_test_progress_updates(state)

        await self._update_pulse_sensor_polling()
        
        # Get tag values for system data
        try:
            pressure_app = self._safe_config(self.config.pressure_app)
            tank_app = self._safe_config(self.config.tank_level_app)
            flow_app = self._safe_config(self.config.flow_meter_sensor_app)
            current_app = self.get_active_current_draw_app()
            pump_app = self._safe_config(self.config.pump_controller_app)

            pressure = self.get_data_tag("value", pressure_app) if pressure_app else None
            tank_level = self.get_data_tag("level_filled_percentage", tank_app) if tank_app else None
            # Raw analogue level reading (metres) — used by the max-flow test
            # to derive volume delta across the sight glass.
            level_reading = self.get_data_tag("level_reading", tank_app) if tank_app else None
            flow_rate = self.get_data_tag("value", flow_app) if flow_app else None
            # Raw flow reading (pre-Kalman); plotted alongside the filtered line.
            flow_rate_unfiltered = self.get_data_tag("unfiltered_value", flow_app) if flow_app else None
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

            # Confidence-weighted fusion across flow + active current-draw
            # detectors. Falls back to whichever detector currently has a
            # rate; returns None when neither does.
            fusion_detectors = []
            if self.flow_pulse_detector is not None:
                fusion_detectors.append(self.flow_pulse_detector)
            if active_cd_detector is not None:
                fusion_detectors.append(active_cd_detector)
            pulse_rate, _ = fuse_pulse_rates(fusion_detectors)
            valve_state = False #self.get_tag("valve_state")
            
            # Store current pressure, flow, and level reading for verification checks
            self.current_pressure = pressure
            self.current_flow = flow_rate
            self.current_flow_unfiltered = flow_rate_unfiltered
            self.current_level_reading = level_reading
            # Keep the MA buffer fed from the raw unfiltered signal.
            if flow_rate_unfiltered is not None:
                self._flow_ma_buffer.append(flow_rate_unfiltered)
            self.current_flow_ma = (
                sum(self._flow_ma_buffer) / len(self._flow_ma_buffer)
                if self._flow_ma_buffer else None
            )
        except Exception as e:
            log.error(f"Error getting tag values: {e}")
            # Use None values if tags are not available
            pressure = None
            tank_level = None
            level_reading = None
            flow_rate = None
            flow_rate_unfiltered = None
            current_draw = None
            pump_duty_cycle = None
            target_pump_duty_cycle = None
            pulse_rate = None
            valve_state = None
            pump_state = None
            self.current_pressure = None
            self.current_flow = None
            self.current_level_reading = None

        # Create current data object for comparison
        current_data = {
            'pressure': pressure,
            'tankLevel': tank_level,
            'levelReading': level_reading,
            'flowRate': flow_rate,
            'flowRateUnfiltered': flow_rate_unfiltered,
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
                'levelReading': level_reading,
                'flowRate': flow_rate,
                'flowRateUnfiltered': flow_rate_unfiltered,
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
        
        # Pacing is handled by pydoover via self.loop_target_period (set in setup())
    
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

    async def set_pump_duty_cycle(self, duty_cycle_pct: float):
        """Directly command a duty-cycle percentage (0-100), bypassing the
        flow-rate → duty-cycle conversion. Used by max-pressure / max-flow
        tests that need to pin the pump at 100%."""
        pump_app = self._safe_config(self.config.pump_controller_app)
        if pump_app:
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

    def reset_max_pressure_verify_tracking(self):
        """Reset 3-stage verify tracking when entering max_pressure_verify."""
        self.max_pressure_verify_start_time = time.time()
        self.max_pressure_verify_baseline = None
        self.max_pressure_peak = None
        self.max_pressure_peak_update_time = None
        self.max_pressure_verify_stage = 'checking'
        self.max_pressure_stage2_start_time = None
        self.max_pressure_stage3_start_time = None
        self.max_pressure_stage3_end_time = None

    def _update_max_pressure_verify_state(self):
        """Update the 3-stage verify state machine based on current pressure.

        Stages:
          - 'checking'   — pump running, waiting for pressure to grow by
                           MAX_PRESSURE_BUILD_THRESHOLD_PCT of target from baseline.
          - 'building'   — pressure climbing; waits until it reaches
                           MAX_PRESSURE_TARGET_HOLD_PCT (99%) of the target.
          - 'stabilising'— target reached; holds for MAX_PRESSURE_STAGE3_DURATION
                           seconds while report data is captured.

        Returns True when Stage 3 has held for the full duration.
        """
        if self.current_pressure is None or self.target_max_pressure is None:
            return False
        if self.max_pressure_verify_start_time is None:
            # Defensive: verify state entered without the on_enter hook firing.
            self.reset_max_pressure_verify_tracking()

        now = time.time()
        # Capture baseline on first good reading after entering verify.
        if self.max_pressure_verify_baseline is None:
            self.max_pressure_verify_baseline = self.current_pressure
            self.max_pressure_peak = self.current_pressure
            self.max_pressure_peak_update_time = now

        # Track peak for display; not used for stage transitions any more.
        if self.current_pressure > (self.max_pressure_peak or 0) + MAX_PRESSURE_STABILISE_TOLERANCE_PSI:
            self.max_pressure_peak = self.current_pressure
            self.max_pressure_peak_update_time = now
        elif self.current_pressure > (self.max_pressure_peak or 0):
            self.max_pressure_peak = self.current_pressure

        growth = self.current_pressure - self.max_pressure_verify_baseline
        build_threshold = self.target_max_pressure * MAX_PRESSURE_BUILD_THRESHOLD_PCT
        target_hold_psi = self.target_max_pressure * MAX_PRESSURE_TARGET_HOLD_PCT

        # Stage 1 -> 2: pressure has started building (passed the 10% growth
        # threshold vs baseline). Record when Stage 2 began so we can raise
        # the "still building" warning after 30s.
        if self.max_pressure_verify_stage == 'checking' and growth >= build_threshold:
            self.max_pressure_verify_stage = 'building'
            self.max_pressure_stage2_start_time = now

        # Stage 2 -> 3: pressure has reached 99% of the target max pressure.
        # Capture stage-3 start time for both the hold-duration check and the
        # report chart's time window filter.
        if (self.max_pressure_verify_stage == 'building'
                and self.current_pressure >= target_hold_psi):
            self.max_pressure_verify_stage = 'stabilising'
            self.max_pressure_stage3_start_time = now

        # Stage 3 exit: held at target for the full stage-3 duration.
        if (self.max_pressure_verify_stage == 'stabilising'
                and self.max_pressure_stage3_start_time is not None):
            stage3_elapsed = now - self.max_pressure_stage3_start_time
            if stage3_elapsed >= MAX_PRESSURE_STAGE3_DURATION:
                self.max_pressure_stage3_end_time = now
                return True

        return False

    def check_max_pressure_verified(self):
        """Verify pressure has built up and stabilised (3-stage logic)."""
        return self._update_max_pressure_verify_state()

    def get_max_pressure_verify_status(self):
        """Return the current verify stage plus numeric diagnostics for the UI.

        Includes raw PSI readings, growth vs threshold, stage timing, and
        warning flags for stages 1 (pump-not-bled) and 2 (target-not-reached).
        """
        now = time.time()
        elapsed = 0.0
        warning = False
        if self.max_pressure_verify_start_time is not None:
            elapsed = now - self.max_pressure_verify_start_time
            if self.max_pressure_verify_stage == 'checking' and elapsed >= MAX_PRESSURE_BUILD_WARNING_TIME:
                warning = True

        # Stage-2 warning: been climbing for >30s without hitting 99% of target.
        stage_two_warning = False
        if (self.max_pressure_verify_stage == 'building'
                and self.max_pressure_stage2_start_time is not None):
            if now - self.max_pressure_stage2_start_time >= MAX_PRESSURE_STAGE2_WARNING_TIME:
                stage_two_warning = True

        stage_number = {'checking': 1, 'building': 2, 'stabilising': 3}.get(
            self.max_pressure_verify_stage, 1
        )

        baseline = self.max_pressure_verify_baseline
        current = self.current_pressure
        peak = self.max_pressure_peak
        growth = (current - baseline) if (current is not None and baseline is not None) else None
        growth_target = (
            self.target_max_pressure * MAX_PRESSURE_BUILD_THRESHOLD_PCT
            if self.target_max_pressure is not None else None
        )
        target_hold_psi = (
            self.target_max_pressure * MAX_PRESSURE_TARGET_HOLD_PCT
            if self.target_max_pressure is not None else None
        )
        stage3_elapsed = (
            now - self.max_pressure_stage3_start_time
            if self.max_pressure_stage3_start_time is not None else None
        )

        return {
            'stage': self.max_pressure_verify_stage,
            'stage_number': stage_number,
            'elapsed': elapsed,
            'warning': warning,
            'stage_two_warning': stage_two_warning,
            'baseline': baseline,
            'current': current,
            'peak': peak,
            'growth': growth,
            'growth_target': growth_target,
            'target_hold_psi': target_hold_psi,
            'stage3_elapsed': stage3_elapsed,
            'stage3_duration': MAX_PRESSURE_STAGE3_DURATION,
            'stage3_start_time': self.max_pressure_stage3_start_time,
            'stage3_end_time': self.max_pressure_stage3_end_time,
        }

    def check_max_flow_start_ready(self):
        return True

    def check_max_flow_regulate_ready(self):
        """Operator has clicked Accept on the max_flow_start screen."""
        return self.shared_flow_confirmation

    def _max_flow_regulate_targets_met(self) -> bool:
        """All three regulate gates: pressure within tolerance, MA flow ≥
        threshold, tank level ≥ 800 mm. The gate uses the MA (not the raw
        value shown on the tile) so it doesn't flicker on noise."""
        if (self.current_pressure is None or self.target_max_flow_pressure_psi is None
                or self.target_max_flow_pressure_tolerance_psi is None
                or self.current_flow_ma is None or self.target_max_flow_rate_lhr is None
                or self.current_level_reading is None):
            return False
        tolerance = self.target_max_flow_pressure_tolerance_psi
        pressure_ok = abs(self.current_pressure - self.target_max_flow_pressure_psi) <= tolerance
        flow_ok = self.current_flow_ma >= self.target_max_flow_rate_lhr
        level_ok = (self.current_level_reading * 1000.0) >= MAX_FLOW_TANK_LEVEL_MIN_MM
        return pressure_ok and flow_ok and level_ok

    def check_max_flow_regulate_complete(self):
        """Operator has held both gates continuously for the hold duration."""
        now = time.time()
        if self._max_flow_regulate_targets_met():
            if self.max_flow_regulate_settled_start is None:
                self.max_flow_regulate_settled_start = now
            elif now - self.max_flow_regulate_settled_start >= MAX_FLOW_REGULATE_HOLD_SECONDS:
                return True
        else:
            # Any miss breaks the hold streak — operator must settle again.
            self.max_flow_regulate_settled_start = None
        return False

    def get_max_flow_regulate_status(self):
        """Diagnostics for the regulate UI.

        `current_flow` is the raw unfiltered coriolis reading — what you see
        on the greyed secondary line of the Flow Rate mini chart. The gate
        compares against the MA internally (exposed as `current_flow_ma` too
        for the UI's tile-OK indicator), so display and gate don't always
        agree instantaneously — the operator watches the noise; the gate
        judges the moving average.
        """
        now = time.time()
        hold_elapsed = (
            now - self.max_flow_regulate_settled_start
            if self.max_flow_regulate_settled_start is not None else 0.0
        )
        pressure_tolerance = self.target_max_flow_pressure_tolerance_psi
        current_level_mm = (
            self.current_level_reading * 1000.0
            if self.current_level_reading is not None else None
        )
        return {
            'current_pressure': self.current_pressure,
            'target_pressure': self.target_max_flow_pressure_psi,
            'pressure_tolerance': pressure_tolerance,
            'current_flow': self.current_flow_unfiltered,
            'current_flow_ma': self.current_flow_ma,
            'target_flow': self.target_max_flow_rate_lhr,
            'current_level_mm': current_level_mm,
            'target_level_mm': MAX_FLOW_TANK_LEVEL_MIN_MM,
            'targets_met': self._max_flow_regulate_targets_met(),
            'hold_elapsed': hold_elapsed,
            'hold_duration': MAX_FLOW_REGULATE_HOLD_SECONDS,
        }

    def check_max_flow_run_ready(self):
        """Operator has confirmed the sight-glass valve is closed."""
        return self.shared_flow_valve_closed_confirmation

    def _expected_level_drop_in(self, seconds: float) -> float | None:
        """Theoretical drop (metres) over `seconds` at rated max flow.

        Returns None if we don't yet know the rated max flow or sight-glass
        area — caller should skip the drop check in that case.
        """
        if (self.flow_accuracy_max_flow_rate is None
                or self.sight_glass_area_m2 is None
                or self.sight_glass_area_m2 <= 0):
            return None
        # L/hr -> m^3/s: (lhr / 3600) / 1000
        volume_rate_m3s = (self.flow_accuracy_max_flow_rate / 3600.0) / 1000.0
        volume_m3 = volume_rate_m3s * seconds
        return volume_m3 / self.sight_glass_area_m2

    def check_max_flow_drop_check_failed(self):
        """After DROP_CHECK_DELAY seconds of running, the level must have dropped
        by at least TOLERANCE_FRACTION of the theoretical drop. If not, the
        sight-glass valve is probably still open.
        """
        if self.max_flow_drop_check_passed:
            return False
        if self.max_flow_run_start_time is None:
            return False
        elapsed = time.time() - self.max_flow_run_start_time
        if elapsed < MAX_FLOW_DROP_CHECK_DELAY:
            return False
        if self.max_flow_initial_level is None or self.current_level_reading is None:
            # Without a valid reading we can't judge — assume OK so we don't
            # bounce the test indefinitely.
            self.max_flow_drop_check_passed = True
            return False
        expected_drop = self._expected_level_drop_in(MAX_FLOW_DROP_CHECK_DELAY)
        if expected_drop is None:
            self.max_flow_drop_check_passed = True
            return False
        required_drop = expected_drop * MAX_FLOW_DROP_CHECK_TOLERANCE_FRACTION
        actual_drop = self.max_flow_initial_level - self.current_level_reading
        if actual_drop >= required_drop:
            self.max_flow_drop_check_passed = True
            return False
        log.warning(
            f"Max-flow drop check failed: actual drop {actual_drop:.5f} m < "
            f"required {required_drop:.5f} m (expected {expected_drop:.5f} m over "
            f"{MAX_FLOW_DROP_CHECK_DELAY}s). Valve may still be open."
        )
        self.max_flow_valve_warning = True
        return True

    def check_max_flow_end_ready(self):
        if self.max_flow_run_start_time is None:
            return False
        elapsed_time = time.time() - self.max_flow_run_start_time
        return elapsed_time >= MAX_FLOW_RUN_DURATION

    def compute_max_flow_result(self):
        """Compute L/hr from (initial - final) * area / duration. Caches onto
        self.max_flow_flow_rate_lhr. Safe to call more than once."""
        if (self.max_flow_initial_level is None
                or self.max_flow_final_level is None
                or self.sight_glass_area_m2 is None):
            self.max_flow_flow_rate_lhr = None
            return None
        level_delta_m = self.max_flow_initial_level - self.max_flow_final_level
        volume_m3 = level_delta_m * self.sight_glass_area_m2
        # m^3 per 60s -> L/hr: * 1000 L/m^3 * 60 min/hr (60s -> 1 hr = *60)
        flow_lhr = (volume_m3 * 1000.0) * (3600.0 / MAX_FLOW_RUN_DURATION)
        self.max_flow_flow_rate_lhr = flow_lhr
        log.info(
            f"Max-flow result: ΔL={level_delta_m:.5f} m, area={self.sight_glass_area_m2} m^2, "
            f"duration={MAX_FLOW_RUN_DURATION}s -> {flow_lhr:.2f} L/hr"
        )
        return flow_lhr


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
        self.max_pressure_verify_start_time = None
        self.max_pressure_verify_baseline = None
        self.max_pressure_peak = None
        self.max_pressure_peak_update_time = None
        self.max_pressure_verify_stage = 'checking'
        self.max_pressure_stage2_start_time = None
        self.max_pressure_stage3_start_time = None
        self.max_pressure_stage3_end_time = None
        # Max-flow test state
        self.max_flow_regulate_settled_start = None
        self.max_flow_run_start_time = None
        self.max_flow_initial_level = None
        self.max_flow_final_level = None
        self.max_flow_drop_check_passed = False
        self.max_flow_valve_warning = False
        self.max_flow_level_history = []
        self.max_flow_flow_rate_lhr = None
        self.flow_accuracy_stabilise_start_time = None
        self.flow_accuracy_phase1_start_time = None
        self.flow_accuracy_phase2_start_time = None
        self.flow_accuracy_phase3_start_time = None
        # Reset confirmation flags
        self.shared_pressure_confirmation = False
        self.shared_flow_confirmation = False
        self.shared_flow_valve_closed_confirmation = False
        self.shared_flow_accuracy_confirmation = False
        # Reset completion acknowledgment flags
        self.shared_pressure_complete_acknowledged = False
        self.shared_flow_complete_acknowledged = False
        self.shared_flow_accuracy_complete_acknowledged = False
        # Reset target pressure and flow
        self.target_max_pressure = None
        self.target_max_flow_pressure_psi = None
        self.target_max_flow_pressure_tolerance_psi = None
        self.target_max_flow_rate_lhr = None
        self.target_flow_accuracy = None
        self.flow_accuracy_max_flow_rate = None

    async def check_state_changes(self, state: str):
        """Detect state changes and notify frontend of important transitions."""
        if state != self.previous_state:
            log.info(f"State changed from {self.previous_state} to {state}")
            
            # Notify frontend when tests complete
            if state == "max_pressure_end" and self.previous_state == "max_pressure_verify":
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
                    'test': 'max_flow',
                    'flow_rate_lhr': self.max_flow_flow_rate_lhr,
                    'initial_level_m': self.max_flow_initial_level,
                    'final_level_m': self.max_flow_final_level,
                    'sight_glass_area_m2': self.sight_glass_area_m2,
                    'duration_seconds': MAX_FLOW_RUN_DURATION,
                    'target_pressure_psi': self.target_max_flow_pressure_psi,
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
        
        if state == "max_pressure_verify":
            status = self.get_max_pressure_verify_status()
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_pressure_verify',
                **status,
            })

        if state == "max_flow_regulate":
            status = self.get_max_flow_regulate_status()
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_flow_regulate',
                **status,
            })

        elif state == "max_flow_prep":
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_flow_prep',
                'initial_level_m': self.max_flow_initial_level,
                'valve_warning': self.max_flow_valve_warning,
            })

        elif state == "max_flow_run" and self.max_flow_run_start_time is not None:
            elapsed = time.time() - self.max_flow_run_start_time
            progress = min(100.0, (elapsed / MAX_FLOW_RUN_DURATION) * 100.0)
            # Record level reading for the report chart while the run is active.
            if self.current_level_reading is not None:
                self.max_flow_level_history.append(
                    (time.time(), self.current_level_reading)
                )
            await self.server.push_test_progress({
                'type': 'test_progress',
                'test': 'max_flow',
                'progress': progress,
                'elapsed': elapsed,
                'duration': MAX_FLOW_RUN_DURATION,
                'initial_level_m': self.max_flow_initial_level,
                'current_level_m': self.current_level_reading,
                'drop_check_passed': self.max_flow_drop_check_passed,
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