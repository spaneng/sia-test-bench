"""Validation and metrics computation for test data."""
import logging
from typing import Dict, Any, List, Optional

log = logging.getLogger(__name__)


# Constants for validation
MAX_SERIES_LENGTH = 100000  # Maximum number of data points
MAX_TIMESTAMP_DIFF_SECONDS = 86400 * 30  # 30 days maximum test duration


def validate_test_data(payload: Dict[str, Any]) -> None:
    """Validate test finalization payload.
    
    Args:
        payload: Dictionary containing:
            - series: List of data points with timestamp, pressure, flowRate, etc.
            - metadata: Optional dict with test metadata
            
    Raises:
        ValueError: If validation fails
    """
    if not isinstance(payload, dict):
        raise ValueError("Payload must be a dictionary")
    
    # Validate series
    if "series" not in payload:
        raise ValueError("Payload must contain 'series' field")
    
    series = payload["series"]
    if not isinstance(series, list):
        raise ValueError("'series' must be a list")
    
    if not series:
        raise ValueError("'series' cannot be empty")
    
    if len(series) > MAX_SERIES_LENGTH:
        raise ValueError(f"'series' length ({len(series)}) exceeds maximum ({MAX_SERIES_LENGTH})")
    
    # Validate each data point in series
    required_fields = {"timestamp"}
    timestamps = []
    
    for i, point in enumerate(series):
        if not isinstance(point, dict):
            raise ValueError(f"Series point at index {i} must be a dictionary")
        
        # Check required fields
        for field in required_fields:
            if field not in point:
                raise ValueError(f"Series point at index {i} missing required field '{field}'")
        
        # Validate timestamp
        timestamp = point["timestamp"]
        if not isinstance(timestamp, (int, float)):
            raise ValueError(f"Series point at index {i} has invalid timestamp type")
        
        if timestamp < 0:
            raise ValueError(f"Series point at index {i} has negative timestamp")
        
        timestamps.append(timestamp)
        
        # Validate numeric fields if present
        for field in ["pressure", "flowRate"]:
            if field in point and point[field] is not None:
                if not isinstance(point[field], (int, float)):
                    raise ValueError(f"Series point at index {i} has invalid {field} type")
    
    # Validate timestamp consistency
    if len(timestamps) > 1:
        min_ts = min(timestamps)
        max_ts = max(timestamps)
        duration = max_ts - min_ts
        
        if duration > MAX_TIMESTAMP_DIFF_SECONDS:
            raise ValueError(
                f"Test duration ({duration:.1f}s) exceeds maximum ({MAX_TIMESTAMP_DIFF_SECONDS}s)"
            )
    
    # Validate metadata if present
    if "metadata" in payload:
        metadata = payload["metadata"]
        if not isinstance(metadata, dict):
            raise ValueError("'metadata' must be a dictionary")


def compute_test_metrics(series: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute summary metrics from test series data.

    Pressure is reported in PSI and flow rate in L/Hr (matching the units
    the frontend sends and the specs reported on the pump config).

    Args:
        series: List of data points, each containing:
            - timestamp: float (Unix timestamp in seconds)
            - pressure: Optional[float] (pressure in PSI)
            - flowRate: Optional[float] (flow rate in L/Hr)
            - pulseRate: Optional[float] (pulse rate in Hz — used to derive RPM)
            - Other optional fields

    Returns:
        Dictionary containing computed metrics:
            - duration_seconds: float
            - start_timestamp: float
            - end_timestamp: float
            - max_flow_lph: Optional[float] (max flow rate in L/Hr)
            - max_pressure_psi: Optional[float] (max pressure in PSI)
            - stabilized_max_pressure_psi: Optional[float] (mean pressure over
              the final third of the run — used as the stabilized max-pressure
              reading for the max-pressure test)
            - rpm_at_max_pressure: Optional[float] (pump RPM sampled at the
              point where max pressure was recorded; pulseRate Hz * 60)
    """
    if not series:
        raise ValueError("Series cannot be empty")

    timestamps = [point["timestamp"] for point in series]
    start_timestamp = min(timestamps)
    end_timestamp = max(timestamps)
    duration_seconds = end_timestamp - start_timestamp

    pressures = [p.get("pressure") for p in series if p.get("pressure") is not None]
    flow_rates = [p.get("flowRate") for p in series if p.get("flowRate") is not None]

    max_pressure_psi = max(pressures) if pressures else None
    max_flow_lph = max(flow_rates) if flow_rates else None

    # Stabilized max pressure: mean over the final third of samples where
    # pressure is present. Gives a steady-state estimate without needing the
    # state machine to annotate the stabilization window.
    stabilized_max_pressure_psi = None
    if pressures:
        tail_start = max(1, len(pressures) * 2 // 3)
        tail = pressures[tail_start:]
        if tail:
            stabilized_max_pressure_psi = sum(tail) / len(tail)

    # RPM at max pressure: find the first sample matching max pressure and
    # convert its pulseRate (Hz) to RPM.
    rpm_at_max_pressure = None
    if max_pressure_psi is not None:
        for point in series:
            if point.get("pressure") == max_pressure_psi:
                pulse_rate_hz = point.get("pulseRate")
                if pulse_rate_hz is not None:
                    rpm_at_max_pressure = pulse_rate_hz * 60.0
                break

    return {
        "duration_seconds": duration_seconds,
        "start_timestamp": start_timestamp,
        "end_timestamp": end_timestamp,
        "max_flow_lph": max_flow_lph,
        "max_pressure_psi": max_pressure_psi,
        "stabilized_max_pressure_psi": stabilized_max_pressure_psi,
        "rpm_at_max_pressure": rpm_at_max_pressure,
    }

