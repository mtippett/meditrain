from __future__ import annotations

import pandas as pd


def to_local_datetime_index(ts):
    """Convert a pandas Series or DatetimeIndex to local timezone and return as DatetimeIndex."""
    import tzlocal

    local_tz = tzlocal.get_localzone()
    ts = pd.to_datetime(ts)
    if ts.dt.tz is None:
        ts = ts.dt.tz_localize("UTC")
    return ts.dt.tz_convert(local_tz)


def _format_time_axis(ax, min_ticks=10, x_min=None, x_max=None):
    import matplotlib.dates as mdates
    import tzlocal

    local_tz = tzlocal.get_localzone()
    if x_min is not None and x_max is not None:
        # Anchor the axis to the full requested range so tick selection is stable.
        ax.set_xlim(x_min, x_max)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=min_ticks))
    ax.xaxis.set_major_formatter(
        mdates.DateFormatter("%Y-%m-%d %H:%M:%S %Z", tz=local_tz)
    )

