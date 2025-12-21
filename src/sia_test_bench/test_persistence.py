"""Persistence module for test data storage.

This module handles storing and retrieving test records using JSON files.
"""
import json
import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional, TextIO
from datetime import datetime

# fcntl is Unix-only; on Windows, file locking behavior will differ
if sys.platform != 'win32':
    import fcntl
else:
    fcntl = None  # type: ignore

log = logging.getLogger(__name__)


class TestPersistence:
    """Handles persistence of test records to JSON files."""
    
    def __init__(self, base_dir: Optional[Path] = None):
        """Initialize the persistence layer.
        
        Args:
            base_dir: Base directory for storing test data. If None, uses
                     data/ directory relative to the module location.
        """
        if base_dir is None:
            # Use data/ directory relative to the package root
            base_dir = Path(__file__).parent.parent.parent / "data"
        
        self.base_dir = Path(base_dir)
        self.tests_dir = self.base_dir / "tests"
        self.reports_dir = self.base_dir / "reports"
        
        # Create directories if they don't exist
        self.tests_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
    
    def get_test_path(self, test_id: str) -> Path:
        """Get the file path for a test record.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            Path object for the test JSON file
        """
        # Sanitize test_id to prevent directory traversal
        safe_id = "".join(c for c in test_id if c.isalnum() or c in "._-")
        if safe_id != test_id:
            log.warning(f"Test ID '{test_id}' was sanitized to '{safe_id}'")
        return self.tests_dir / f"{safe_id}.json"
    
    def get_report_path(self, test_id: str) -> Path:
        """Get the file path for a test report PDF.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            Path object for the report PDF file
        """
        safe_id = "".join(c for c in test_id if c.isalnum() or c in "._-")
        return self.reports_dir / f"{safe_id}.pdf"
    
    def get_lock_path(self, test_id: str) -> Path:
        """Get the file path for a test finalization lock file.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            Path object for the lock file
        """
        safe_id = "".join(c for c in test_id if c.isalnum() or c in "._-")
        return self.tests_dir / f".{safe_id}.lock"
    
    def save_test_record(self, test_id: str, test_record: Dict[str, Any]) -> None:
        """Save a test record to disk.
        
        Args:
            test_id: Unique test identifier
            test_record: Dictionary containing test data, metrics, and metadata
            
        Raises:
            IOError: If file write fails
        """
        file_path = self.get_test_path(test_id)
        
        # Add test_id to record if not present
        if "test_id" not in test_record:
            test_record["test_id"] = test_id
        
        # Write atomically using temporary file
        temp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(test_record, f, indent=2, ensure_ascii=False)
            temp_path.replace(file_path)
            log.info(f"Saved test record for {test_id} to {file_path}")
        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            raise IOError(f"Failed to save test record for {test_id}: {e}") from e
    
    def load_test_record(self, test_id: str) -> Optional[Dict[str, Any]]:
        """Load a test record from disk.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            Dictionary containing test data, or None if not found
        """
        file_path = self.get_test_path(test_id)
        
        if not file_path.exists():
            return None
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                record = json.load(f)
            log.debug(f"Loaded test record for {test_id} from {file_path}")
            return record
        except json.JSONDecodeError as e:
            log.error(f"Invalid JSON in test record file {file_path}: {e}")
            raise ValueError(f"Corrupted test record file for {test_id}") from e
        except Exception as e:
            log.error(f"Failed to load test record for {test_id}: {e}")
            raise IOError(f"Failed to load test record for {test_id}: {e}") from e
    
    def test_record_exists(self, test_id: str) -> bool:
        """Check if a test record exists.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            True if the test record exists, False otherwise
        """
        return self.get_test_path(test_id).exists()
    
    def save_report_pdf(self, test_id: str, pdf_bytes: bytes) -> None:
        """Save a PDF report to disk atomically.
        
        Args:
            test_id: Unique test identifier
            pdf_bytes: PDF file bytes
            
        Raises:
            IOError: If file write fails
        """
        file_path = self.get_report_path(test_id)
        
        # Write atomically using temporary file
        temp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        try:
            with open(temp_path, "wb") as f:
                f.write(pdf_bytes)
            temp_path.replace(file_path)
            log.info(f"Saved PDF report for {test_id} to {file_path}")
        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            raise IOError(f"Failed to save PDF report for {test_id}: {e}") from e
    
    def load_report_pdf(self, test_id: str) -> Optional[bytes]:
        """Load a PDF report from disk.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            PDF bytes, or None if not found
        """
        file_path = self.get_report_path(test_id)
        
        if not file_path.exists():
            return None
        
        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
            log.debug(f"Loaded PDF report for {test_id} from {file_path}")
            return pdf_bytes
        except Exception as e:
            log.error(f"Failed to load PDF report for {test_id}: {e}")
            raise IOError(f"Failed to load PDF report for {test_id}: {e}") from e
    
    def report_exists(self, test_id: str) -> bool:
        """Check if a PDF report exists.
        
        Args:
            test_id: Unique test identifier
            
        Returns:
            True if the report exists, False otherwise
        """
        return self.get_report_path(test_id).exists()
    
    def acquire_finalization_lock(self, test_id: str, timeout: float = 30.0) -> Optional[TextIO]:
        """Acquire an exclusive lock for finalizing a test.
        
        Args:
            test_id: Unique test identifier
            timeout: Maximum time to wait for lock acquisition (seconds)
                      Note: Currently not used, lock is non-blocking
            
        Returns:
            Lock file handle if acquired, None if lock already held (test being finalized)
            
        Note:
            Lock is automatically released when the file handle is closed.
            Use as a context manager or ensure proper cleanup.
            On Windows, file locking behavior may differ (uses file existence check only).
        """
        lock_path = self.get_lock_path(test_id)
        
        # Try to acquire lock (non-blocking check first)
        if lock_path.exists():
            log.debug(f"Lock file exists for test {test_id}, test may be currently finalizing")
            return None
        
        lock_file: Optional[TextIO] = None
        try:
            # Create and lock the lock file
            lock_file = open(lock_path, 'w')
            if fcntl is not None:
                # Unix: use fcntl for proper file locking
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except (IOError, OSError):
                    # Lock already held by another process
                    lock_file.close()
                    return None
            # Windows: file existence check above provides basic protection
            # For stronger locking on Windows, could use msvcrt.locking or file locking libraries
            lock_file.write(f"locked_by_finalization_{test_id}\n")
            lock_file.flush()
            log.debug(f"Acquired finalization lock for test {test_id}")
            return lock_file
        except (IOError, OSError) as e:
            if lock_file is not None:
                try:
                    lock_file.close()
                except Exception:
                    pass
            log.debug(f"Could not acquire lock for test {test_id}: {e}")
            return None
    
    def save_test_record_and_pdf_atomic(
        self, 
        test_id: str, 
        test_record: Dict[str, Any], 
        pdf_bytes: bytes
    ) -> None:
        """Atomically save both test record and PDF report.
        
        If either save fails, both are rolled back (removed).
        
        Args:
            test_id: Unique test identifier
            test_record: Dictionary containing test data, metrics, and metadata
            pdf_bytes: PDF file bytes
            
        Raises:
            IOError: If save fails (both files removed if partial write occurred)
        """
        test_path = self.get_test_path(test_id)
        report_path = self.get_report_path(test_id)
        test_temp = test_path.with_suffix(test_path.suffix + ".tmp")
        report_temp = report_path.with_suffix(report_path.suffix + ".tmp")
        
        test_saved = False
        report_saved = False
        
        try:
            # Save test record
            if "test_id" not in test_record:
                test_record["test_id"] = test_id
            
            with open(test_temp, "w", encoding="utf-8") as f:
                json.dump(test_record, f, indent=2, ensure_ascii=False)
            test_temp.replace(test_path)
            test_saved = True
            log.debug(f"Test record saved for {test_id}")
            
            # Save PDF report
            with open(report_temp, "wb") as f:
                f.write(pdf_bytes)
            report_temp.replace(report_path)
            report_saved = True
            log.debug(f"PDF report saved for {test_id}")
            
            log.info(f"Atomically saved test record and PDF for {test_id}")
            
        except Exception as e:
            # Rollback: remove any partially saved files
            if test_saved and test_path.exists():
                try:
                    test_path.unlink()
                    log.warning(f"Rolled back test record for {test_id} due to error")
                except Exception:
                    pass
            
            if report_saved and report_path.exists():
                try:
                    report_path.unlink()
                    log.warning(f"Rolled back PDF report for {test_id} due to error")
                except Exception:
                    pass
            
            # Clean up temp files
            for temp_file in [test_temp, report_temp]:
                if temp_file.exists():
                    try:
                        temp_file.unlink()
                    except Exception:
                        pass
            
            raise IOError(f"Failed to atomically save test data for {test_id}: {e}") from e

