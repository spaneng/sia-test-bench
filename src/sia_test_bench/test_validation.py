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
    
    Args:
        series: List of data points, each containing:
            - timestamp: float (Unix timestamp in seconds)
            - pressure: Optional[float] (pressure in PSI, converted to kPa)
            - flowRate: Optional[float] (flow rate in L/Hr, converted to LPM)
            - Other optional fields
    
    Returns:
        Dictionary containing computed metrics:
            - duration_seconds: float
            - max_flow_lpm: Optional[float] (max flow rate in L/min)
            - max_pressure_kpa: Optional[float] (max pressure in kPa)
            - start_timestamp: float
            - end_timestamp: float
            - data_point_count: int
    """
    if not series:
        raise ValueError("Series cannot be empty")
    
    timestamps = [point["timestamp"] for point in series]
    start_timestamp = min(timestamps)
    end_timestamp = max(timestamps)
    duration_seconds = end_timestamp - start_timestamp
    
    # Extract pressure and flow rate values (filter out None)
    pressures = [point.get("pressure") for point in series if point.get("pressure") is not None]
    flow_rates = [point.get("flowRate") for point in series if point.get("flowRate") is not None]
    
    # Compute max pressure (convert PSI to kPa: 1 PSI = 6.89476 kPa)
    max_pressure_kpa = None
    if pressures:
        max_pressure_psi = max(pressures)
        max_pressure_kpa = max_pressure_psi * 6.89476
    
    # Compute max flow rate (convert L/Hr to LPM: divide by 60)
    max_flow_lpm = None
    if flow_rates:
        max_flow_lph = max(flow_rates)
        max_flow_lpm = max_flow_lph / 60.0
    
    return {
        "duration_seconds": duration_seconds,
        "max_flow_lpm": max_flow_lpm,
        "max_pressure_kpa": max_pressure_kpa,
        "start_timestamp": start_timestamp,
        "end_timestamp": end_timestamp,
        "data_point_count": len(series),
    }

