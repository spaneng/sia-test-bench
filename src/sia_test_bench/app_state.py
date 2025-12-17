import logging

from pydoover.state import StateMachine

log = logging.getLogger(__name__)

class SiaTestBenchState:
    state: str

    states = [
        {"name": "off"},
        {"name": "auto_start"},
        {"name": "auto_stop"},
        {"name": "max_pressure_start"},
        {"name": "max_pressure_run", "on_enter": "on_enter_max_pressure_run"},
        {"name": "max_pressure_end"},
        {"name": "max_flow_start"},
        {"name": "max_flow_run", "on_enter": "on_enter_max_flow_run"},
        {"name": "max_flow_end"},
    ]

    transitions = [
        {"trigger": "set_off", "source": "*", "dest": "off"},
        {"trigger": "start_auto", "source": "off", "dest": "auto_start"},
        {"trigger": "init_max_pressure", "source": ["off","auto_start"], "dest": "max_pressure_start"},
        {"trigger": "start_max_pressure", "source": "max_pressure_start", "dest": "max_pressure_run"},
        {"trigger": "stop_max_pressure", "source": "max_pressure_run", "dest": "max_pressure_end"},
        {"trigger": "init_max_flow", "source": ["off","auto_start","max_pressure_end"], "dest": "max_flow_start"},
        {"trigger": "start_max_flow", "source": "max_flow_start", "dest": "max_flow_run"},
        {"trigger": "stop_max_flow", "source": "max_flow_run", "dest": "max_flow_end"},
        {"trigger": "set_off", "source": "*", "dest": "off"},
        {"trigger": "stop_auto", "source": "max_flow_end", "dest": "off"},
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

        elif s == "auto_start":
            if self.app.check_auto_ready():
                log.info("Auto ready received")
                await self.init_max_pressure()

        elif s == "max_pressure_start":
            if self.app.check_max_pressure_run_ready():
                log.info("Max pressure run ready received")
                await self.start_max_pressure()
        elif s == "max_pressure_run":
            if self.app.check_max_pressure_end_ready():
                log.info("Max pressure end ready received")
                await self.stop_max_pressure()
        elif s == "max_pressure_end":
            if self.app.check_max_pressure_end_ready():
                if self.app.shared_testmode == "auto":
                    log.info("Max flow start ready received")
                    await self.init_max_flow()
                else:
                    self.app.clear_shared_testmode()
                    await self.set_off()
        elif s == "max_flow_start":
            if self.app.check_max_flow_run_ready():
                log.info("Max flow run ready received")
                await self.start_max_flow()
        elif s == "max_flow_run":
            if self.app.check_max_flow_end_ready():
                log.info("Max flow end ready received")
                await self.stop_max_flow()
        elif s == "max_flow_end":
            if self.app.check_max_flow_end_ready():
                if self.app.shared_testmode == "auto":
                    log.info("Max flow end ready received")
                    self.app.clear_shared_testmode()
                    await self.stop_auto()
                else:
                    self.app.clear_shared_testmode()
                    await self.set_off()
        elif s == "auto_stop":
            log.info("Auto stop received")
            await self.set_off()

    async def on_enter_max_pressure_run(self):
        """Set the timer when entering max_pressure_run state."""
        import time
        self.app.max_pressure_run_start_time = time.time()
        log.info("Max pressure run started - 30 second timer initiated")

    async def on_enter_max_flow_run(self):
        """Set the timer when entering max_flow_run state."""
        import time
        self.app.max_flow_run_start_time = time.time()
        log.info("Max flow run started - 30 second timer initiated")