"""Report generation module for test results.

This module provides adapter functions for generating charts and PDF reports from test data.
It wraps the existing reporting.py functions and adapts the data format.
"""
import logging
from typing import List, Dict, Any

from .reporting import render_test_chart_png as _render_chart, generate_report_pdf as _generate_pdf

log = logging.getLogger(__name__)


def normalize_pump_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize pump metadata into the canonical keys used by the report templates.

    The frontend sends pump_serial / pump_model / pump_name; templates read
    serial_number / model / name. We build the canonical set and drop the
    source aliases so no duplicate rows (e.g. both "Serial" and "Serial Number")
    get rendered by the generic fallback loop in the template.

    Args:
        metadata: Dictionary with pump metadata fields.

    Returns:
        Normalized metadata with canonical keys only.
    """
    normalized = dict(metadata)

    def _promote(source: str, target: str) -> None:
        if source in normalized:
            value = normalized.pop(source)
            normalized.setdefault(target, value)

    _promote('pump_serial', 'serial_number')
    _promote('pump_model', 'model')
    _promote('pump_name', 'name')

    # Drop the duplicate short "serial" alias; the template shows serial_number.
    normalized.pop('serial', None)

    return normalized


def render_test_chart_png(series: List[Dict[str, Any]], test_name: str = None) -> bytes:
    """Render a test chart as PNG bytes.

    The frontend already sends pressure in PSI and flow rate in L/Hr; we plot
    those units directly so the chart matches the summary metrics in the
    report.

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

    timestamps = [point["timestamp"] for point in series]
    if not timestamps:
        raise ValueError("Series must contain timestamps")

    start_time = min(timestamps)
    time_series = [(ts - start_time) for ts in timestamps]

    pressure_psi = [point.get("pressure") or 0.0 for point in series]

    # Max-pressure test reports current draw vs pressure (not flow) because
    # flow is essentially zero against a closed valve, so it tells us nothing
    # about what the pump is doing. Current draw is the meaningful signal.
    is_max_pressure = bool(test_name and "pressure" in test_name.lower())
    if is_max_pressure:
        left_values = [point.get("currentDraw") or 0.0 for point in series]
        return _render_chart(
            time_series, left_values, pressure_psi, test_name=test_name,
            left_label='Current', left_unit='A', left_color='#E63946',
        )

    # Max-flow test: plot the analogue sight-glass level (mm) vs time. Pressure
    # on the secondary axis is still useful to confirm the operator held the
    # regulator at ~30% during the 60s run.
    is_max_flow = bool(
        test_name and "flow" in test_name.lower() and "accuracy" not in test_name.lower()
    )
    if is_max_flow:
        level_mm = [
            (point.get("levelReading") or 0.0) * 1000.0 for point in series
        ]
        return _render_chart(
            time_series, level_mm, pressure_psi, test_name=test_name,
            left_label='Sight Glass Level', left_unit='mm', left_color='#2563eb',
        )

    flow_lph = [point.get("flowRate") or 0.0 for point in series]
    return _render_chart(time_series, flow_lph, pressure_psi, test_name=test_name)


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
    
    series = test_record.get("series", [])

    timestamps = [point["timestamp"] for point in series] if series else []
    if timestamps:
        start_time = timestamps[0]
        time_seconds = [(ts - start_time) for ts in timestamps]
    else:
        time_seconds = []

    flow_lph = [point.get("flowRate") or 0.0 for point in series]
    pressure_psi = [point.get("pressure") or 0.0 for point in series]

    raw_metadata = test_record.get("metadata", {})
    normalized_metadata = normalize_pump_metadata(raw_metadata)

    # Enrich metrics with deviation-from-spec for the max-pressure test.
    metrics = dict(test_record.get("metrics", {}))
    marketed_max_pressure = _coerce_float(normalized_metadata.get("max_pressure"))
    stabilized = metrics.get("stabilized_max_pressure_psi")
    if marketed_max_pressure and stabilized is not None:
        metrics["marketed_max_pressure_psi"] = marketed_max_pressure
        metrics["stabilized_max_pressure_deviation_pct"] = (
            (stabilized - marketed_max_pressure) / marketed_max_pressure * 100.0
        )

    # Promote max-flow result fields from metadata into the metrics dict so the
    # report template can render them in the Summary Metrics section without
    # having to know about this test type specifically.
    for src, dest in (
        ("max_flow_flow_rate_lhr", "max_flow_flow_rate_lhr"),
        ("max_flow_initial_level_m", "max_flow_initial_level_m"),
        ("max_flow_final_level_m", "max_flow_final_level_m"),
        ("max_flow_sight_glass_area_m2", "max_flow_sight_glass_area_m2"),
        ("max_flow_duration_seconds", "max_flow_duration_seconds"),
    ):
        val = _coerce_float(normalized_metadata.pop(src, None))
        if val is not None:
            metrics[dest] = val

    adapted_record = {
        "pump_metadata": normalized_metadata,
        "timestamps": timestamps,
        "time_seconds": time_seconds,
        "flow_lph": flow_lph,
        "pressure_psi": pressure_psi,
        "metrics": metrics,
        "test_type": test_record.get("test_type"),
        "test_name": test_record.get("test_name"),
        "notes": normalized_metadata.get("notes", ""),
    }

    return _generate_pdf(adapted_record, chart_png_bytes)


def _coerce_float(value) -> float | None:
    """Best-effort conversion of a metadata value to float."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
