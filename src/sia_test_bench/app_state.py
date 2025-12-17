import logging

from pydoover.state import StateMachine

log = logging.getLogger(__name__)

class SiaTestBenchState:
    state: str

    states = [
        {"name": "off"},
        {"name": "auto_start", "on_enter": "on_enter_auto_start"},
        {"name": "auto_stop"},
        {"name": "max_pressure_start"},
        {"name": "max_pressure_run"},
        {"name": "max_pressure_end"},
        {"name": "max_flow_start"},
        {"name": "max_flow_run"},
        {"name": "max_flow_end"},
    ]

    transitions = [
        {"trigger": "set_off", "source": "*", "dest": "off"},
        {"trigger": "start_auto", "source": "off", "dest": "auto_start"},
        {"trigger": "init_max_pressure", "source": ["off","auto_start"], "dest": "max_pressure_start"},
        {"trigger": "start_max_pressure", "source": "max_pressure_start", "dest": "max_pressure_run"},
        {"trigger": "stop_max_pressure", "source": "max_pressure_run", "dest": "max_pressure_end"},
        {"trigger": "init_max_flow", "source": ["off","auto_start"], "dest": "max_flow_start"},
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
        if check_off_command():
            await self.on_enter_off()

        elif s == "off":
            if check_auto_command():
                await self.start_auto()
            if self.app.check_max_pressure_command():
                await self.init_max_pressure()
            if self.app.check_max_flow_command():
                await self.init_max_flow()

        elif s == "auto_start":
            if self.app.check_auto_ready():
                await self.init_max_pressure()

        elif s == "max_pressure_start":
            if self.app.check_max_pressure_run_ready():
                await self.start_max_pressure()
        elif s == "max_pressure_run":
            if self.app.check_max_pressure_end_ready():
                await self.stop_max_pressure()
        elif s == "max_pressure_end":
            if self.app.check_max_pressure_end_ready():
                if self.app.get_tag("auto_test"):
                    await self.init_max_flow()
                else:
                    await self.set_off()
        elif s == "max_flow_start":
            if self.app.check_max_flow_run_ready():
                await self.start_max_flow()
        elif s == "max_flow_run":
            if self.app.check_max_flow_end_ready():
                await self.stop_max_flow()
        elif s == "max_flow_end":
            if self.app.check_max_flow_end_ready():
                if self.app.get_tag("auto_test"):
                    await self.stop_auto()
                else:
                    await self.set_off()
        elif s == "auto_stop":
            await self.set_off()

    async def on_enter_auto_start(self):
        self.app.set_tag("auto_test", True)

    async def on_enter_auto_stop(self):
        self.app.set_tag("auto_test", False)
