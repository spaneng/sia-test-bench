import asyncio
import logging
import time
from collections import deque

import numpy as np
from pydoover.tags.manager import KeyPath

log = logging.getLogger(__name__)

# Analysis parameters
BUFFER_SECONDS = 15         # Seconds of data to keep in the buffer
ANALYSIS_INTERVAL = 2.0     # Seconds between pulse rate recalculations
EXPECTED_SAMPLE_RATE = 5.0  # Expected tag update rate (used as fallback)
MIN_FREQ_HZ = 0.3           # Lowest pulse rate we look for
MAX_FREQ_HZ = 2.0           # Highest pulse rate we look for
BUFFER_SIZE = int(EXPECTED_SAMPLE_RATE * BUFFER_SECONDS)


class PulseRateDetector:
    """Detects pump pulse rate from flow rate sensor data.

    Subscribes to the flow rate tag via pydoover's subscribe_to_tag()
    to receive every update as it arrives (push-based, not polled).
    Periodically analyses the buffered values using autocorrelation and FFT.
    """

    def __init__(self):
        self._buffer = deque(maxlen=BUFFER_SIZE)
        self._pulse_rate = None       # Latest pulse rate estimate (Hz)
        self._confidence = 0.0        # 0.0 - 1.0
        self._analysis_task = None
        self._running = False

    @property
    def pulse_rate(self):
        """Current pulse rate in Hz, or None if not yet determined."""
        return self._pulse_rate

    @property
    def confidence(self):
        """Confidence of the current estimate (0.0 - 1.0)."""
        return self._confidence

    def subscribe(self, app, tag_key="value", app_key=None, data_dda_uri=None):
        """Register with pydoover's tag subscription system.

        Args:
            app: The pydoover Application instance.
            tag_key: The tag name to subscribe to (e.g. "value").
            app_key: The application key for the flow meter sensor.
            data_dda_uri: If set, subscribe via the remote tag manager.
        """
        if data_dda_uri and app.remote_tag_manager is not None:
            app.remote_tag_manager.subscribe_to_tag(
                tag_key,
                callback=self._on_tag_update,
                app_key=app_key,
            )
        else:
            app.subscribe_to_tag(tag_key, self._on_tag_update, app_key=app_key)
        self._running = True
        self._analysis_task = asyncio.ensure_future(self._analysis_loop())
        log.info(
            f"Pulse detector subscribed to tag '{tag_key}' "
            f"(app_key={app_key}, data_dda_uri={data_dda_uri!r})"
        )

    async def stop(self):
        """Stop the analysis loop."""
        self._running = False
        if self._analysis_task and not self._analysis_task.done():
            self._analysis_task.cancel()
            try:
                await self._analysis_task
            except asyncio.CancelledError:
                pass

    def _on_tag_update(self, key, value):
        """Callback invoked by pydoover on every tag value change."""
        if value is None:
            return
        try:
            self._buffer.append((time.monotonic(), float(value)))
        except (TypeError, ValueError):
            pass

    async def _analysis_loop(self):
        """Periodically analyse the buffer to compute pulse rate."""
        while self._running:
            await asyncio.sleep(ANALYSIS_INTERVAL)
            if len(self._buffer) >= 10:
                self._analyse()

    def _analyse(self):
        """Run autocorrelation and FFT on the buffer to estimate pulse rate."""
        timestamps, values = zip(*self._buffer)
        values = np.array(values, dtype=np.float64)
        ts = np.array(timestamps)

        # Derive actual sample rate from timestamps
        dts = np.diff(ts)
        dt = np.median(dts)
        actual_fs = 1.0 / dt if dt > 0 else EXPECTED_SAMPLE_RATE

        # Remove DC offset
        values = values - np.mean(values)

        # Skip if signal is essentially flat (pump off or no flow)
        if np.std(values) < 1e-6:
            self._pulse_rate = None
            self._confidence = 0.0
            return

        ac_rate, ac_conf = self._autocorrelation_method(values, actual_fs)
        fft_rate, fft_conf = self._fft_method(values, actual_fs)
        self._combine_estimates(ac_rate, ac_conf, fft_rate, fft_conf)

    def _autocorrelation_method(self, values, fs):
        """Estimate pulse rate via normalized autocorrelation."""
        n = len(values)
        fft_vals = np.fft.fft(values, n=2 * n)
        acf = np.fft.ifft(fft_vals * np.conj(fft_vals)).real[:n]
        acf /= acf[0] if acf[0] != 0 else 1.0

        min_lag = max(1, int(fs / MAX_FREQ_HZ))
        max_lag = min(n // 2, int(fs / MIN_FREQ_HZ))

        if max_lag <= min_lag:
            return None, 0.0

        search_region = acf[min_lag:max_lag + 1]

        peaks = []
        for i in range(1, len(search_region) - 1):
            if search_region[i] > search_region[i - 1] and search_region[i] > search_region[i + 1]:
                peaks.append((i + min_lag, search_region[i]))

        if not peaks:
            return None, 0.0

        best_lag, best_val = max(peaks, key=lambda p: p[1])

        # Parabolic interpolation for sub-sample accuracy
        if 1 <= best_lag < n - 1:
            y_m1 = acf[best_lag - 1]
            y_0 = acf[best_lag]
            y_p1 = acf[best_lag + 1]
            denom = 2.0 * (2.0 * y_0 - y_m1 - y_p1)
            if abs(denom) > 1e-12:
                delta = (y_m1 - y_p1) / denom
                best_lag = best_lag + delta

        rate = fs / best_lag
        confidence = min(1.0, max(0.0, best_val))

        if MIN_FREQ_HZ <= rate <= MAX_FREQ_HZ:
            return rate, confidence
        return None, 0.0

    def _fft_method(self, values, fs):
        """Estimate pulse rate via FFT power spectrum."""
        n = len(values)
        window = np.hanning(n)
        windowed = values * window

        fft_result = np.fft.rfft(windowed)
        power = np.abs(fft_result) ** 2
        freqs = np.fft.rfftfreq(n, d=1.0 / fs)

        mask = (freqs >= MIN_FREQ_HZ) & (freqs <= MAX_FREQ_HZ)
        if not np.any(mask):
            return None, 0.0

        valid_power = power[mask]
        valid_freqs = freqs[mask]

        peak_idx = np.argmax(valid_power)
        peak_freq = valid_freqs[peak_idx]
        peak_power = valid_power[peak_idx]

        total_power = np.sum(valid_power)
        confidence = float(peak_power / total_power) if total_power > 0 else 0.0

        if MIN_FREQ_HZ <= peak_freq <= MAX_FREQ_HZ:
            return peak_freq, confidence
        return None, 0.0

    def _combine_estimates(self, ac_rate, ac_conf, fft_rate, fft_conf):
        """Combine autocorrelation and FFT estimates with weighted averaging."""
        estimates = []
        if ac_rate is not None and ac_conf > 0.2:
            estimates.append((ac_rate, ac_conf))
        if fft_rate is not None and fft_conf > 0.1:
            estimates.append((fft_rate, fft_conf))

        if not estimates:
            self._pulse_rate = None
            self._confidence = 0.0
            return

        if len(estimates) == 2:
            r1, c1 = estimates[0]
            r2, c2 = estimates[1]
            diff = abs(r1 - r2) / max(r1, r2)
            if diff < 0.15:
                total_c = c1 + c2
                rate = (r1 * c1 + r2 * c2) / total_c
                conf = min(1.0, (c1 + c2) / 2.0 * (1.0 + (1.0 - diff)))
                self._pulse_rate = round(rate, 3)
                self._confidence = round(conf, 3)
                log.debug(f"Pulse rate: {self._pulse_rate} Hz (AC={r1:.3f}, FFT={r2:.3f}, conf={self._confidence})")
                return

        best_rate, best_conf = max(estimates, key=lambda e: e[1])
        self._pulse_rate = round(best_rate, 3)
        self._confidence = round(best_conf, 3)
        log.debug(f"Pulse rate: {self._pulse_rate} Hz (conf={self._confidence})")
