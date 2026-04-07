from pathlib import Path

from pydoover import config


class SiaTestBenchConfig(config.Schema):
    data_dda = config.String(
        "Data DDA",
        default="",
        description=(
            "URI of the DDA whose tag_values supply sensor and pump readouts. "
            "Leave empty to read tags from the local device agent only."
        ),
    )
    pump_controller_app = config.Application(
        "Pump Controller App",
        description="The pump 1 application",
    )
    tank_level_app = config.Application(
        "Tank Level App",
        description="The tank level application",
    )
    pressure_app = config.Application(
        "Pressure App",
        description="The pressure sensor application",
    )
    flow_meter_sensor_app = config.Application(
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
