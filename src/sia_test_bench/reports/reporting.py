"""
Reporting and visualization module for pump testing application.

Provides functions for generating PNG charts and PDF reports from test data.
"""

import base64
import io
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for headless operation
import matplotlib.pyplot as plt
from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

# Set matplotlib parameters for print-friendly output
plt.rcParams.update({
    'figure.dpi': 150,
    'savefig.dpi': 300,
    'savefig.bbox': 'tight',
    'font.size': 10,
    'axes.labelsize': 10,
    'axes.titlesize': 12,
    'xtick.labelsize': 9,
    'ytick.labelsize': 9,
    'legend.fontsize': 9,
    'figure.titlesize': 12,
    'font.family': 'sans-serif',
    'font.sans-serif': ['Arial', 'DejaVu Sans', 'Liberation Sans'],
    'axes.linewidth': 0.8,
    'grid.linewidth': 0.5,
    'lines.linewidth': 1.2,
})


def render_test_chart_png(
    time_series: List[float],
    flow_lpm: List[float],
    pressure_kpa: List[float],
    figure_size: tuple = (8.27, 5.85),  # A4 landscape aspect ratio
    test_name: Optional[str] = None
) -> bytes:
    """
    Render a test chart as PNG bytes with dual Y-axes.
    
    Args:
        time_series: Array of time values (seconds or timestamps)
        flow_lpm: Flow rate series in L/min
        pressure_kpa: Pressure series in kPa
        figure_size: Tuple of (width, height) in inches (default: A4 landscape)
        test_name: Optional test name to include in the title
    
    Returns:
        PNG image bytes
    """
    # Create figure with specified size
    fig, ax1 = plt.subplots(figsize=figure_size, facecolor='white')
    
    # Plot flow on left Y-axis
    color_flow = '#1f77b4'  # Blue
    ax1.set_xlabel('Time (s)', fontweight='bold')
    ax1.set_ylabel('Flow Rate (L/min)', color=color_flow, fontweight='bold')
    line1 = ax1.plot(time_series, flow_lpm, color=color_flow, linewidth=1.5, label='Flow Rate')
    ax1.tick_params(axis='y', labelcolor=color_flow)
    ax1.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    ax1.set_facecolor('#fafafa')
    
    # Create second Y-axis for pressure
    ax2 = ax1.twinx()
    color_pressure = '#d62728'  # Red
    ax2.set_ylabel('Pressure (kPa)', color=color_pressure, fontweight='bold')
    line2 = ax2.plot(time_series, pressure_kpa, color=color_pressure, linewidth=1.5, label='Pressure')
    ax2.tick_params(axis='y', labelcolor=color_pressure)
    
    # Add title with test name if provided
    if test_name:
        title = f'{test_name} Results'
    else:
        title = 'Pump Test Results'
    ax1.set_title(title, fontweight='bold', pad=15)
    
    # Add legend
    lines = line1 + line2
    labels = [l.get_label() for l in lines]
    ax1.legend(lines, labels, loc='upper left', framealpha=0.9, edgecolor='gray')
    
    # Tight layout to prevent clipping
    plt.tight_layout()
    
    # Save to bytes buffer
    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
    buf.seek(0)
    png_bytes = buf.read()
    buf.close()
    plt.close(fig)
    
    return png_bytes


def generate_report_pdf(
    test_record: Dict,
    chart_png: bytes,
    template_dir: Optional[Path] = None
) -> bytes:
    """
    Generate a PDF report from test record data and chart image.
    
    Args:
        test_record: Dictionary containing:
            - pump_metadata: dict with pump details (name, model, serial, etc.)
            - timestamps: optional list of timestamps
            - time_seconds: optional list of time values in seconds
            - flow_lpm: list of flow values in L/min
            - pressure_kpa: list of pressure values in kPa
            - metrics: dict with computed metrics (max_flow, max_pressure, avg_flow, etc.)
            - notes: optional string with test notes
        chart_png: PNG image bytes from render_test_chart_png
        template_dir: Optional path to template directory (defaults to module directory)
    
    Returns:
        PDF bytes
    """
    # Determine template directory
    if template_dir is None:
        template_dir = Path(__file__).parent / 'templates'
    else:
        template_dir = Path(template_dir)
    
    # Ensure template directory exists
    template_dir.mkdir(parents=True, exist_ok=True)
    
    # Setup Jinja2 environment
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(['html', 'xml'])
    )
    
    # Load template
    template = env.get_template('report.html')
    
    # Encode chart as base64
    chart_base64 = base64.b64encode(chart_png).decode('utf-8')
    
    # Prepare template context
    context = {
        'test_record': test_record,
        'chart_base64': chart_base64,
        'generation_timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'pump_metadata': test_record.get('pump_metadata', {}),
        'metrics': test_record.get('metrics', {}),
        'notes': test_record.get('notes', ''),
    }
    
    # Render HTML
    html_content = template.render(**context)
    
    # Convert to PDF using WeasyPrint
    pdf_bytes = HTML(string=html_content).write_pdf()
    
    return pdf_bytes


def generate_report_with_chart(test_record: Dict, template_dir: Optional[Path] = None) -> bytes:
    """
    Convenience function to generate both chart and PDF report.
    
    Args:
        test_record: Dictionary containing test data (see generate_report_pdf)
        template_dir: Optional path to template directory
    
    Returns:
        PDF bytes
    """
    # Extract time series
    time_series = test_record.get('time_seconds', [])
    if not time_series and 'timestamps' in test_record:
        # Convert timestamps to seconds if needed
        timestamps = test_record['timestamps']
        if timestamps:
            start_time = timestamps[0]
            time_series = [(ts - start_time) for ts in timestamps]
    
    # Extract data series
    flow_lpm = test_record.get('flow_lpm', [])
    pressure_kpa = test_record.get('pressure_kpa', [])
    
    # Generate chart
    chart_png = render_test_chart_png(time_series, flow_lpm, pressure_kpa)
    
    # Generate PDF
    pdf_bytes = generate_report_pdf(test_record, chart_png, template_dir)
    
    return pdf_bytes

