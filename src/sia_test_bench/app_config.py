from pathlib import Path

from pydoover import config


class SiaTestBenchConfig(config.Schema):
    pump_controller = config.Application(
        "Pump Controller App",
        description="The pump 1 application",
    )
    tank_level_app = config.Application(
        "Tank Level App",
        description="The tank level application",
    )
    pressure_sensor_app = config.Application(
        "Pressure App",
        description="The pressure sensor application",
    )
    flow_sensor_app = config.Application(
        "Flow Meter Sensor App",
        description="The flow sensor application",
    )
    current_draw_app = config.Application(
        "Current Draw App",
        description="The current draw application",
    )


def export():
    SiaTestBenchConfig.export(
        Path(__file__).parents[2] / "doover_config.json",
        "sia_test_bench",
    )


if __name__ == "__main__":
    export()
