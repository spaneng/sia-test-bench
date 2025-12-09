"""
Basic tests for an application.

This ensures all modules are importable and that the config is valid.
"""

def test_import_app():
    from sia_test_bench.application import SiaTestBenchApplication
    assert SiaTestBenchApplication

def test_config():
    from sia_test_bench.app_config import SiaTestBenchConfig

    config = SiaTestBenchConfig()
    assert isinstance(config.to_dict(), dict)

def test_ui():
    from sia_test_bench.app_ui import SiaTestBenchUI
    assert SiaTestBenchUI

def test_state():
    from sia_test_bench.app_state import SiaTestBenchState
    assert SiaTestBenchState