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
        {"name": "max_pressure_verify", "timeout": 30, "on_timeout": "init_max_pressure", "on_enter": "start_pump"},
        {"name": "max_pressure_stabilise", "on_enter": "on_enter_max_pressure_stabilise"},
        {"name": "max_pressure_run", "on_enter": "on_enter_max_pressure_run", "on_exit": "stop_pump"},
        {"name": "max_pressure_end"},
        {"name": "max_flow_start", "on_enter": "stop_pump"},
        {"name": "max_flow_verify", "timeout": 30, "on_timeout": "init_max_flow", "on_enter": "start_pump"},
        {"name": "max_flow_stabilise", "on_enter": "on_enter_max_flow_stabilise"},
        {"name": "max_flow_run", "on_enter": "on_enter_max_flow_run", "on_exit": "stop_pump"},
        {"name": "max_flow_end"},
        {"name": "flow_accuracy_start", "on_enter": "stop_pump"},
        {"name": "flow_accuracy_verify", "timeout": 30, "on_timeout": "init_flow_accuracy", "on_enter": "start_pump"},
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
        {"trigger": "stabilise_max_pressure", "source": "max_pressure_verify", "dest": "max_pressure_stabilise"},
        {"trigger": "run_max_pressure", "source": "max_pressure_stabilise", "dest": "max_pressure_run"},
        {"trigger": "stop_max_pressure", "source": "max_pressure_run", "dest": "max_pressure_end"},
        {"trigger": "init_max_flow", "source": ["off","auto_start","max_pressure_end","max_flow_verify"], "dest": "max_flow_start"},
        {"trigger": "verify_max_flow", "source": "max_flow_start", "dest": "max_flow_verify"},
        {"trigger": "stabilise_max_flow", "source": "max_flow_verify", "dest": "max_flow_stabilise"},
        {"trigger": "run_max_flow", "source": "max_flow_stabilise", "dest": "max_flow_run"},
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
                log.info("Max pressure verified")
                await self.stabilise_max_pressure()
        elif s == "max_pressure_stabilise":
            if self.app.check_max_pressure_stabilised():
                log.info("Max pressure stabilisation complete")
                await self.run_max_pressure()
        elif s == "max_pressure_run":
            if self.app.check_max_pressure_end_ready():
                log.info("Max pressure test run complete")
                await self.stop_max_pressure()
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
            if self.app.check_max_flow_run_ready():
                log.info("Max flow run ready received - user clicked Accept")
                # Reset confirmation flag after reading it
                self.app.shared_flow_confirmation = False
                await self.verify_max_flow()
        elif s == "max_flow_verify":
            if self.app.check_max_flow_verified():
                log.info("Max flow verified")
                await self.stabilise_max_flow()
        elif s == "max_flow_stabilise":
            if self.app.check_max_flow_stabilised():
                log.info("Max flow stabilisation complete")
                await self.run_max_flow()
        elif s == "max_flow_run":
            if self.app.check_max_flow_end_ready():
                log.info("Max flow test run complete")
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

    async def on_enter_max_pressure_stabilise(self):
        """Set the timer when entering max_pressure_stabilise state."""
        import time
        self.app.max_pressure_stabilise_start_time = time.time()
        log.info("Max pressure stabilise started - 10 second timer initiated")

    async def on_enter_max_pressure_run(self):
        """Set the timer when entering max_pressure_run state."""
        import time
        self.app.max_pressure_run_start_time = time.time()
        log.info("Max pressure run started - 10 second timer initiated")

    async def start_pump(self):
        await self.app.start_pump()

    async def stop_pump(self):
        await self.app.stop_pump()

    async def on_enter_max_flow_stabilise(self):
        """Set the timer when entering max_flow_stabilise state."""
        import time
        self.app.max_flow_stabilise_start_time = time.time()
        log.info("Max flow stabilise started - 10 second timer initiated")

    async def on_enter_max_flow_run(self):
        """Set the timer when entering max_flow_run state."""
        import time
        self.app.max_flow_run_start_time = time.time()
        log.info("Max flow run started - 10 second timer initiated")

    async def on_enter_flow_accuracy_stabilise(self):
        """Set the timer when entering flow_accuracy_stabilise state."""
        import time
        self.app.flow_accuracy_stabilise_start_time = time.time()
        log.info("Flow accuracy stabilise started - timer initiated")

    async def on_enter_flow_accuracy_phase1(self):
        """Set the timer when entering flow_accuracy_phase1 state."""
        import time
        self.app.flow_accuracy_phase1_start_time = time.time()
        log.info("Flow accuracy phase 1 started - timer initiated")

    async def on_enter_flow_accuracy_phase2(self):
        """Set the timer when entering flow_accuracy_phase2 state."""
        import time
        self.app.flow_accuracy_phase2_start_time = time.time()
        log.info("Flow accuracy phase 2 started - timer initiated")

    async def on_enter_flow_accuracy_phase3(self):
        """Set the timer when entering flow_accuracy_phase3 state."""
        import time
        self.app.flow_accuracy_phase3_start_time = time.time()
        log.info("Flow accuracy phase 3 started - timer initiated")

    async def on_enter_off(self):
        """Clean up when entering off state."""
        log.info("Entering off state - resetting test mode and timers")
        await self.stop_pump()
        self.app.clear_shared_testmode()