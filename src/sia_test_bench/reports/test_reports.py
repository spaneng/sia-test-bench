"""Report generation module for test results.

This module provides adapter functions for generating charts and PDF reports from test data.
It wraps the existing reporting.py functions and adapts the data format.
"""
import logging
from typing import List, Dict, Any

from .reporting import render_test_chart_png as _render_chart, generate_report_pdf as _generate_pdf

log = logging.getLogger(__name__)


def normalize_pump_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize pump metadata fields to ensure consistent structure.
    
    Maps frontend field names to standardized backend field names:
    - pump_serial -> serial, serial_number (also preserved as pump_serial for compatibility)
    - pump_model -> model (also preserved as pump_model for compatibility)
    - pump_name -> name (also preserved as pump_name for compatibility)
    
    All original fields are preserved, with standardized names added for template compatibility.
    
    Args:
        metadata: Dictionary with pump metadata fields
        
    Returns:
        Normalized metadata dictionary with both original and standardized field names
    """
    normalized = dict(metadata)  # Preserve all original fields
    
    # Map common field name variations to standardized names
    # Frontend sends: pump_serial, pump_model, pump_name
    # Template may expect: serial, serial_number, model, name (or vice versa)
    # We provide all variations for compatibility
    if 'pump_serial' in normalized:
        if 'serial' not in normalized:
            normalized['serial'] = normalized['pump_serial']
        if 'serial_number' not in normalized:
            normalized['serial_number'] = normalized['pump_serial']
    if 'pump_model' in normalized and 'model' not in normalized:
        normalized['model'] = normalized['pump_model']
    if 'pump_name' in normalized and 'name' not in normalized:
        normalized['name'] = normalized['pump_name']
    
    # Also ensure reverse mapping for templates expecting pump_* prefix
    if 'serial' in normalized and 'pump_serial' not in normalized:
        normalized['pump_serial'] = normalized['serial']
        if 'serial_number' not in normalized:
            normalized['serial_number'] = normalized['serial']
    if 'serial_number' in normalized:
        if 'serial' not in normalized:
            normalized['serial'] = normalized['serial_number']
        if 'pump_serial' not in normalized:
            normalized['pump_serial'] = normalized['serial_number']
    if 'model' in normalized and 'pump_model' not in normalized:
        normalized['pump_model'] = normalized['model']
    if 'name' in normalized and 'pump_name' not in normalized:
        normalized['pump_name'] = normalized['name']
    
    return normalized


def render_test_chart_png(series: List[Dict[str, Any]], test_name: str = None) -> bytes:
    """Render a test chart as PNG bytes.
    
    Args:
        series: List of data points, each containing:
            - timestamp: float (Unix timestamp in seconds)
            - pressure: Optional[float] (pressure in PSI)
            - flowRate: Optional[float] (flow rate in L/Hr)
            - Other optional fields
        test_name: Optional test name to include in the chart title
            
    Returns:
        PNG image bytes
        
    Raises:
        ValueError: If series is empty or invalid
        RuntimeError: If chart generation fails
    """
    if not series:
        raise ValueError("Series cannot be empty")
    
    # Extract timestamps and convert to relative time in seconds
    timestamps = [point["timestamp"] for point in series]
    if not timestamps:
        raise ValueError("Series must contain timestamps")
    
    start_time = min(timestamps)
    time_series = [(ts - start_time) for ts in timestamps]
    
    # Extract flow rate (convert L/Hr to LPM)
    flow_lpm = []
    for point in series:
        flow_rate = point.get("flowRate")
        if flow_rate is not None:
            flow_lpm.append(flow_rate / 60.0)  # Convert L/Hr to L/min
        else:
            flow_lpm.append(0.0)
    
    # Extract pressure (convert PSI to kPa: 1 PSI = 6.89476 kPa)
    pressure_kpa = []
    for point in series:
        pressure = point.get("pressure")
        if pressure is not None:
            pressure_kpa.append(pressure * 6.89476)  # Convert PSI to kPa
        else:
            pressure_kpa.append(0.0)
    
    # Call the existing chart rendering function with test name
    return _render_chart(time_series, flow_lpm, pressure_kpa, test_name=test_name)


def generate_report_pdf(test_record: Dict[str, Any], chart_png_bytes: bytes) -> bytes:
    """Generate a PDF report from test record and chart image.
    
    Args:
        test_record: Dictionary containing test metadata and metrics:
            - test_id: str
            - metadata: Dict with test metadata
            - metrics: Dict with computed metrics (duration_seconds, max_flow_lpm, etc.)
            - series: List of data points (for extracting time series data)
            - generated_at: ISO timestamp string
        chart_png_bytes: PNG image bytes for the chart
            
    Returns:
        PDF bytes
        
    Raises:
        ValueError: If test_record is invalid
        RuntimeError: If PDF generation fails
    """
    if not test_record:
        raise ValueError("test_record cannot be empty")
    
    if not isinstance(chart_png_bytes, bytes):
        raise ValueError("chart_png_bytes must be bytes")
    
    # Adapt test_record format for the existing generate_report_pdf function
    # The existing function expects specific fields, so we need to map them
    series = test_record.get("series", [])
    
    # Extract time series data
    timestamps = [point["timestamp"] for point in series] if series else []
    if timestamps:
        start_time = timestamps[0]
        time_seconds = [(ts - start_time) for ts in timestamps]
    else:
        time_seconds = []
    
    # Extract flow and pressure data with conversions
    flow_lpm = []
    pressure_kpa = []
    for point in series:
        flow_rate = point.get("flowRate")
        if flow_rate is not None:
            flow_lpm.append(flow_rate / 60.0)  # L/Hr to L/min
        else:
            flow_lpm.append(0.0)
        
        pressure = point.get("pressure")
        if pressure is not None:
            pressure_kpa.append(pressure * 6.89476)  # PSI to kPa
        else:
            pressure_kpa.append(0.0)
    
    # Normalize metadata to ensure consistent field mapping
    raw_metadata = test_record.get("metadata", {})
    normalized_metadata = normalize_pump_metadata(raw_metadata)
    
    # Prepare test_record in the format expected by the existing function
    adapted_record = {
        "pump_metadata": normalized_metadata,
        "timestamps": timestamps,
        "time_seconds": time_seconds,
        "flow_lpm": flow_lpm,
        "pressure_kpa": pressure_kpa,
        "metrics": test_record.get("metrics", {}),
        "notes": normalized_metadata.get("notes", ""),
    }
    
    # Call the existing PDF generation function
    return _generate_pdf(adapted_record, chart_png_bytes)
