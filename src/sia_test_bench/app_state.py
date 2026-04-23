import logging

from pydoover.state import StateMachine

log = logging.getLogger(__name__)

class SiaTestBenchState:
    state: str

    states = [
        {"name": "off", "on_enter": "on_enter_off"},
        {"name": "auto_start"},
        {"name": "auto_stop"},
        {"name": "max_pressure_start", "on_enter": "stop_pump"},
        {"name": "max_pressure_verify", "on_enter": "on_enter_max_pressure_verify"},
        {"name": "max_pressure_end", "on_enter": "stop_pump"},
        {"name": "max_flow_start", "on_enter": "stop_pump"},
        # Pump at 100%; operator dials the regulator to ~30% pressure while the
        # coriolis flow climbs to ≥97% of max. Both must hold together briefly.
        {"name": "max_flow_regulate", "on_enter": "on_enter_max_flow_regulate"},
        # Pump stopped. Record initial level, prompt operator to close the
        # sight-glass valve. Re-entered from run if the drop check fails.
        {"name": "max_flow_prep", "on_enter": "on_enter_max_flow_prep"},
        # Pump at 100% for 60s. At 10s, verify level is actually dropping.
        {"name": "max_flow_run", "on_enter": "on_enter_max_flow_run", "on_exit": "stop_pump"},
        {"name": "max_flow_end", "on_enter": "on_enter_max_flow_end"},
        {"name": "flow_accuracy_start", "on_enter": "stop_pump"},
        {"name": "flow_accuracy_verify", "timeout": 30, "on_timeout": "on_timeout_flow_accuracy_verify", "on_enter": "start_pump"},
        {"name": "flow_accuracy_stabilise", "on_enter": "on_enter_flow_accuracy_stabilise"},
        {"name": "flow_accuracy_phase1", "on_enter": "on_enter_flow_accuracy_phase1"},
        {"name": "flow_accuracy_phase2", "on_enter": "on_enter_flow_accuracy_phase2"},
        {"name": "flow_accuracy_phase3", "on_enter": "on_enter_flow_accuracy_phase3", "on_exit": "stop_pump"},
        {"name": "flow_accuracy_end"},
    ]

    transitions = [
        {"trigger": "set_off", "source": "*", "dest": "off"},
        {"trigger": "start_auto", "source": "off", "dest": "auto_start"},
        {"trigger": "init_max_pressure", "source": ["off","auto_start","max_pressure_verify"], "dest": "max_pressure_start"},
        {"trigger": "verify_max_pressure", "source": "max_pressure_start", "dest": "max_pressure_verify"},
        # Max-pressure verify stage 3 captures report data for 60s; once it
        # passes, go straight to end. Pump stops via max_pressure_end's on_enter.
        {"trigger": "end_max_pressure", "source": "max_pressure_verify", "dest": "max_pressure_end"},
        {"trigger": "init_max_flow", "source": ["off","auto_start","max_pressure_end","max_flow_regulate"], "dest": "max_flow_start"},
        {"trigger": "regulate_max_flow", "source": "max_flow_start", "dest": "max_flow_regulate"},
        {"trigger": "prep_max_flow", "source": "max_flow_regulate", "dest": "max_flow_prep"},
        {"trigger": "run_max_flow", "source": "max_flow_prep", "dest": "max_flow_run"},
        # Drop-check failure bounces back to prep so the operator can re-close
        # the valve and continue without restarting the pressure-regulate step.
        {"trigger": "retry_max_flow_prep", "source": "max_flow_run", "dest": "max_flow_prep"},
        {"trigger": "stop_max_flow", "source": "max_flow_run", "dest": "max_flow_end"},
        {"trigger": "init_flow_accuracy", "source": ["off", "max_flow_end", "flow_accuracy_verify"], "dest": "flow_accuracy_start"},
        {"trigger": "verify_flow_accuracy", "source": "flow_accuracy_start", "dest": "flow_accuracy_verify"},
        {"trigger": "stabilise_flow_accuracy", "source": "flow_accuracy_verify", "dest": "flow_accuracy_stabilise"},
        {"trigger": "run_flow_accuracy_phase1", "source": "flow_accuracy_stabilise", "dest": "flow_accuracy_phase1"},
        {"trigger": "run_flow_accuracy_phase2", "source": "flow_accuracy_phase1", "dest": "flow_accuracy_phase2"},
        {"trigger": "run_flow_accuracy_phase3", "source": "flow_accuracy_phase2", "dest": "flow_accuracy_phase3"},
        {"trigger": "stop_flow_accuracy", "source": "flow_accuracy_phase3", "dest": "flow_accuracy_end"},
        {"trigger": "set_off", "source": "*", "dest": "off"},
        {"trigger": "stop_auto", "source": "flow_accuracy_end", "dest": "off"},
    ]

    def __init__(self, app):

        self.app = app

        self.state_machine = StateMachine(
            states=self.states,
            transitions=self.transitions,
            model=self,
            initial="off",
            queued=True,
        )

    def get_state_string(self):
        """
        Returns the display string of the current state.
        """
        ## Iterate through the states to find the one with "name" matching the current state
        for state in self.states:
            if state["name"] == self.state:
                return STATE_NAME_LOOKUP.get(state["name"], "...")
        return "..."

    async def spin_state(self): 
        log.info("Spinning state")
        last_state = None
        ## keep spinning until state has stabilised
        while last_state != self.state:
            last_state = self.state
            await self.evaluate_state()
            # log.info(f"State spin complete for {self.name} - {self.state}")

        log.info(f"State is: {self.state}")
        return self.state

    async def evaluate_state(self):
        s = self.state
        if self.app.check_off_command():
            log.info("Off command received")
            await self.on_enter_off()

        elif s == "off":
            if self.app.check_auto_command():
                log.info("Auto command received")
                await self.start_auto()
            if self.app.check_max_pressure_command():
                log.info("Max pressure command received")
                await self.init_max_pressure()
            if self.app.check_max_flow_command():
                log.info("Max flow command received")
                await self.init_max_flow()
            if self.app.check_flow_accuracy_command():
                log.info("Flow accuracy command received")
                await self.init_flow_accuracy()

        elif s == "auto_start":
            if self.app.check_auto_ready():
                log.info("Auto ready received")
                await self.init_max_pressure()

        elif s == "max_pressure_start":
            if self.app.check_max_pressure_run_ready():
                log.info("Max pressure run ready received - user clicked Accept")
                # Reset confirmation flag after reading it
                self.app.shared_pressure_confirmation = False
                await self.verify_max_pressure()
        elif s == "max_pressure_verify":
            if self.app.check_max_pressure_verified():
                log.info("Max pressure Stage 3 complete — ending test")
                await self.end_max_pressure()
        elif s == "max_pressure_end":
            if self.app.check_max_pressure_complete():
                log.info("Max pressure completion acknowledged by frontend")
                # Reset acknowledgment flag after reading it
                self.app.shared_pressure_complete_acknowledged = False
                if self.app.shared_testmode == "auto":
                    log.info("Max flow start ready received")
                    await self.init_max_flow()
                else:
                    self.app.clear_shared_testmode()
                    await self.set_off()
        elif s == "max_flow_start":
            if self.app.check_max_flow_regulate_ready():
                log.info("Max flow regulate ready - user clicked Accept on start screen")
                self.app.shared_flow_confirmation = False
                await self.regulate_max_flow()
        elif s == "max_flow_regulate":
            if self.app.check_max_flow_regulate_complete():
                log.info("Max flow regulate targets held — moving to prep")
                await self.prep_max_flow()
        elif s == "max_flow_prep":
            if self.app.check_max_flow_run_ready():
                log.info("Max flow valve-closed confirmed — starting 60s run")
                self.app.shared_flow_valve_closed_confirmation = False
                await self.run_max_flow()
        elif s == "max_flow_run":
            # Drop-check failure takes priority over timer completion — if the
            # valve was never closed, we bounce back instead of ending.
            if self.app.check_max_flow_drop_check_failed():
                log.warning("Max flow drop-check failed — returning to prep")
                await self.retry_max_flow_prep()
            elif self.app.check_max_flow_end_ready():
                log.info("Max flow 60s run complete")
                await self.stop_max_flow()
        elif s == "max_flow_end":
            if self.app.check_max_flow_complete():
                log.info("Max flow completion acknowledged by frontend")
                # Reset acknowledgment flag after reading it
                self.app.shared_flow_complete_acknowledged = False
                if self.app.shared_testmode == "auto":
                    log.info("Flow accuracy start ready received")
                    await self.init_flow_accuracy()
                else:
                    self.app.clear_shared_testmode()
                    await self.set_off()
        elif s == "flow_accuracy_start":
            if self.app.check_flow_accuracy_run_ready():
                log.info("Flow accuracy run ready received - user clicked Accept")
                # Reset confirmation flag after reading it
                self.app.shared_flow_accuracy_confirmation = False
                await self.verify_flow_accuracy()
        elif s == "flow_accuracy_verify":
            if self.app.check_flow_accuracy_verified():
                log.info("Flow accuracy verified")
                await self.stabilise_flow_accuracy()
        elif s == "flow_accuracy_stabilise":
            if self.app.check_flow_accuracy_stabilised():
                log.info("Flow accuracy stabilisation complete")
                await self.run_flow_accuracy_phase1()
        elif s == "flow_accuracy_phase1":
            if self.app.check_flow_accuracy_phase1_complete():
                log.info("Flow accuracy phase 1 complete")
                await self.run_flow_accuracy_phase2()
        elif s == "flow_accuracy_phase2":
            if self.app.check_flow_accuracy_phase2_complete():
                log.info("Flow accuracy phase 2 complete")
                await self.run_flow_accuracy_phase3()
        elif s == "flow_accuracy_phase3":
            if self.app.check_flow_accuracy_phase3_complete():
                log.info("Flow accuracy phase 3 complete")
                await self.stop_flow_accuracy()
        elif s == "flow_accuracy_end":
            if self.app.check_flow_accuracy_complete():
                log.info("Flow accuracy completion acknowledged by frontend")
                # Reset acknowledgment flag after reading it
                self.app.shared_flow_accuracy_complete_acknowledged = False
                if self.app.shared_testmode == "auto":
                    log.info("Auto test complete")
                    self.app.clear_shared_testmode()
                    await self.stop_auto()
                else:
                    self.app.clear_shared_testmode()
                    await self.set_off()
        elif s == "auto_stop":
            log.info("Auto stop received")
            await self.set_off()

    async def start_pump(self):
        await self.app.start_pump()

    async def stop_pump(self):
        await self.app.stop_pump()

    async def on_enter_max_flow_regulate(self):
        """Start pump at 100% duty while the operator dials the regulator."""
        import time
        self.app.max_flow_regulate_settled_start = None
        await self.app.start_pump()
        await self.app.set_pump_duty_cycle(100)
        log.info(
            "Max flow regulate started — targets: "
            f"pressure ≥ {self.app.target_max_flow_pressure_psi} PSI, "
            f"flow ≥ {self.app.target_max_flow_rate_lhr} L/hr"
        )

    async def on_enter_max_flow_prep(self):
        """Stop pump, capture initial level, wait for operator to close valve."""
        await self.app.stop_pump()
        # First entry: record initial level; on retry (drop-check failure) the
        # initial level was already captured on the first entry — keep it.
        if self.app.max_flow_initial_level is None:
            self.app.max_flow_initial_level = self.app.current_level_reading
            log.info(f"Max flow prep: initial level recorded = {self.app.max_flow_initial_level} m")
        else:
            log.info("Max flow prep (retry) — keeping original initial level")
        self.app.max_flow_drop_check_passed = False
        self.app.max_flow_run_start_time = None

    async def on_enter_max_flow_run(self):
        """Start the 60s run at 100% duty. Fresh level-history buffer."""
        import time
        self.app.max_flow_run_start_time = time.time()
        self.app.max_flow_level_history = []
        self.app.max_flow_drop_check_passed = False
        # Clear stale warning — operator has actioned it and is retrying.
        self.app.max_flow_valve_warning = False
        await self.app.start_pump()
        await self.app.set_pump_duty_cycle(100)
        log.info("Max flow run started — 60 second timer initiated")

    async def on_enter_max_flow_end(self):
        """Stop pump, capture final level, compute L/hr."""
        await self.app.stop_pump()
        self.app.max_flow_final_level = self.app.current_level_reading
        self.app.compute_max_flow_result()
        log.info(
            f"Max flow end: initial={self.app.max_flow_initial_level} m, "
            f"final={self.app.max_flow_final_level} m, "
            f"flow={self.app.max_flow_flow_rate_lhr} L/hr"
        )

    async def on_enter_flow_accuracy_stabilise(self):
        """Set the timer when entering flow_accuracy_stabilise state."""
        import time
        self.app.flow_accuracy_stabilise_start_time = time.time()
        log.info("Flow accuracy stabilise started - timer initiated")

    async def on_enter_flow_accuracy_phase1(self):
        """Set the timer and flow rate (10%) when entering flow_accuracy_phase1 state."""
        import time
        self.app.flow_accuracy_phase1_start_time = time.time()
        # Set flow rate to 10% of max
        if self.app.flow_accuracy_max_flow_rate is not None:
            target_flow = self.app.flow_accuracy_max_flow_rate * 0.10
            await self.app.set_flow_rate(target_flow)
            log.info(f"Flow accuracy phase 1 started - flow rate set to {target_flow} L/Hr (10%)")
        else:
            log.warning("Flow accuracy phase 1 started - max flow rate not set")

    async def on_enter_flow_accuracy_phase2(self):
        """Set the timer and flow rate (50%) when entering flow_accuracy_phase2 state."""
        import time
        self.app.flow_accuracy_phase2_start_time = time.time()
        # Set flow rate to 50% of max
        if self.app.flow_accuracy_max_flow_rate is not None:
            target_flow = self.app.flow_accuracy_max_flow_rate * 0.50
            await self.app.set_flow_rate(target_flow)
            log.info(f"Flow accuracy phase 2 started - flow rate set to {target_flow} L/Hr (50%)")
        else:
            log.warning("Flow accuracy phase 2 started - max flow rate not set")

    async def on_enter_flow_accuracy_phase3(self):
        """Set the timer and flow rate (100%) when entering flow_accuracy_phase3 state."""
        import time
        self.app.flow_accuracy_phase3_start_time = time.time()
        # Set flow rate to 100% of max
        if self.app.flow_accuracy_max_flow_rate is not None:
            target_flow = self.app.flow_accuracy_max_flow_rate * 1.00
            await self.app.set_flow_rate(target_flow)
            log.info(f"Flow accuracy phase 3 started - flow rate set to {target_flow} L/Hr (100%)")
        else:
            log.warning("Flow accuracy phase 3 started - max flow rate not set")

    async def on_enter_off(self):
        """Clean up when entering off state."""
        log.info("Entering off state - resetting test mode and timers")
        await self.stop_pump()
        self.app.clear_shared_testmode()

    async def on_enter_max_pressure_verify(self):
        """Reset verify tracking, capture baseline pressure, start the pump at 100% duty."""
        self.app.reset_max_pressure_verify_tracking()
        await self.app.start_pump()
        await self.app.set_pump_duty_cycle(100)
        log.info("Max pressure verify started at 100%% duty — tracking 10%% build-up from baseline")

    async def on_timeout_flow_accuracy_verify(self):
        """Handle timeout for flow_accuracy_verify - go back to start."""
        log.info("Flow accuracy verify timed out - returning to flow_accuracy_start")
        await self.init_flow_accuracy()