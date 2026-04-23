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
    injection_controller_app = config.Application(
        "Injection Controller App",
        description=(
            "The SIA injection controller whose calibration_gauge_area is "
            "used as the sight glass area for the max-flow test."
        ),
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
    current_draw_24vdc_app = config.Application(
        "Current Draw 24VDC App",
        description="The current transducer application for 24VDC pumps",
    )
    current_draw_12vdc_app = config.Application(
        "Current Draw 12VDC App",
        description="The current transducer application for 12VDC pumps",
    )
    current_draw_240vac_app = config.Application(
        "Current Draw 240VAC App",
        description="The current transducer application for 240VAC pumps",
    )
    pulse_source = config.Enum(
        "Pulse Detection Source",
        choices=["flow", "current_draw", "both"],
        default="flow",
        description="Which sensor(s) to use for pulse rate detection.",
    )


def export():
    SiaTestBenchConfig.export(
        Path(__file__).parents[2] / "doover_config.json",
        "sia_test_bench",
    )


def export_ui():
    pass


if __name__ == "__main__":
    export()
