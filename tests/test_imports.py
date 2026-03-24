"""
Basic tests for the SIA test bench application.

This ensures all modules are importable and that the config is valid.
"""


def test_import_app():
    from sia_test_bench.application import SiaTestBenchApplication
    assert SiaTestBenchApplication
    assert SiaTestBenchApplication.config_cls is not None


def test_config():
    from sia_test_bench.app_config import SiaTestBenchConfig

    schema = SiaTestBenchConfig.to_schema()
    assert isinstance(schema, dict)
    assert len(schema["properties"]) > 0


def test_state():
    from sia_test_bench.app_state import SiaTestBenchState
    assert SiaTestBenchState
