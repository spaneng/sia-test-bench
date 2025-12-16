from pathlib import Path

from pydoover import config


class SiaTestBenchConfig(config.Schema):
    def __init__(self):
        self.pump_controller = config.Application("Pump Controller App", description="The pump 1 application")
        self.tank_level_app = config.Application("Tank Level App", description="The tank level application")
        self.pressure_sensor_app = config.Application("Pressure App", description="The pressure sensor application")
        # self.barcode_reader_path = config.String("Barcode Reader Path")
        


def export():
    SiaTestBenchConfig().export(Path(__file__).parents[2] / "doover_config.json", "sia_test_bench")

if __name__ == "__main__":
    export()
