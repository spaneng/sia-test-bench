from pydoover.docker import run_app

from .application import SiaTestBenchApplication
from .app_config import SiaTestBenchConfig

def main():
    """
    Run the application.
    """
    run_app(SiaTestBenchApplication(config=SiaTestBenchConfig()))
