from pathlib import Path

from pydoover import config


class SiaTestBenchConfig(config.Schema):
    def __init__(self):
        self.barcode_reader_path = config.String("Barcode Reader Path")
        


def export():
    SiaTestBenchConfig().export(Path(__file__).parents[2] / "doover_config.json", "sia_test_bench")

if __name__ == "__main__":
    export()
