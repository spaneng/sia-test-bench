from pydoover.docker import run_app

from .application import SiaTestBenchApplication


def main():
    run_app(SiaTestBenchApplication())
