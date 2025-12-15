#!/usr/bin/env python3
"""
Standalone runner for the TestBenchServer.
This runs server.py directly without the Doover framework.
"""
import asyncio
import logging
import signal
import sys

from src.sia_test_bench.server import TestBenchServer

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
log = logging.getLogger(__name__)


async def main():
    """Main entry point."""
    server = TestBenchServer()
    
    # Setup signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        log.info(f"Received signal {signum}, shutting down...")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Initialize the server
        log.info("Starting TestBench Server...")
        await server.setup()
        
        log.info("Server is running. Press Ctrl+C to stop.")
        
        # Keep the server running
        while True:
            await server.main_loop()
            
    except KeyboardInterrupt:
        log.info("Keyboard interrupt received")
    except Exception as e:
        log.error(f"Server error: {e}", exc_info=True)
    finally:
        # Cleanup
        log.info("Cleaning up...")
        await server.cleanup()
        log.info("Server stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Shutdown complete")

