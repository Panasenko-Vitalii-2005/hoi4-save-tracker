"""
HOI4 Autosave Graph Viewer

Simple GUI for plotting metrics from autosave_intervals.json.

Dependencies:
    pip install matplotlib

Run:
    python hoi4_graph_gui.py
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.figure import Figure
from matplotlib.lines import Line2D


DEFAULT_JSON  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "autosave_intervals.json")
SETTINGS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gui_settings.json")

NUMERIC_METRICS = [
    "file_size_mb",
    "write_duration_seconds",
    "write_speed_mb_per_sec",
    "cpu_avg",
    "cpu_max",
    "ram_avg",
    "ram_max",
    "resource_samples",
    "divisions",
    "army_groups",
    "ships",
    "planes",
    "active_countries",
    "parse_seconds",
    "interval_seconds",
    "game_days_passed",
    "seconds_per_game_day",
]

X_MODES = [
    "save_index",
    "real_time",
    "game_date",
]

PRESETS: dict[str, dict[str, Any]] = {
    "Performance": {
        "metrics": ["write_duration_seconds", "write_speed_mb_per_sec", "parse_seconds"],
        "x_mode": "real_time",
        "ma_window": 1,
        "normalize": False,
        "unique_game_date_only": True,
        "description": "Save/write/parse timing over real time.",
    },
    "System Load": {
        "metrics": ["cpu_avg", "cpu_max", "ram_avg", "ram_max", "resource_samples"],
        "x_mode": "real_time",
        "ma_window": 2,
        "normalize": False,
        "unique_game_date_only": True,
        "description": "CPU and RAM behavior during save writes.",
    },
    "Military Growth": {
        "metrics": ["divisions", "army_groups", "ships", "planes", "active_countries"],
        "x_mode": "game_date",
        "ma_window": 1,
        "normalize": False,
        "unique_game_date_only": True,
        "description": "In-game force growth by game date.",
    },
    "Compare Trends": {
        "metrics": ["write_duration_seconds", "cpu_avg", "ram_avg", "divisions", "ships", "planes"],
        "x_mode": "game_date",
        "ma_window": 3,
        "normalize": True,
        "unique_game_date_only": True,
        "description": "Normalized multi-metric trend comparison.",
    },
    "Duplicate Finder": {
        "metrics": ["write_duration_seconds", "file_size_mb", "write_speed_mb_per_sec"],
        "x_mode": "real_time",
        "ma_window": 1,
        "normalize": False,
        "unique_game_date_only": False,
        "description": "Keep duplicate game_date records visible for diagnostics.",
    },
}


@dataclass
class ParsedData:
    records: list[dict[str, Any]]
    source_path: str


class GraphApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("HOI4 Autosave Graph Viewer")
        self.root.geometry("1280x820")

        self.json_path = tk.StringVar(value=DEFAULT_JSON)
        self.x_mode = tk.StringVar(value="save_index")
        self.ma_window = tk.IntVar(value=1)
        self.normalize_enabled = tk.BooleanVar(value=False)
        self.unique_game_date_only = tk.BooleanVar(value=False)
        self.separate_scale_enabled = tk.BooleanVar(value=False)
        self.last_preset_name = tk.StringVar(value="")

        self.metric_vars: dict[str, tk.BooleanVar] = {}
        self.parsed = ParsedData(records=[], source_path=self.json_path.get())
        self.settings_path = SETTINGS_JSON
        self.hover_points: list[dict[str, Any]] = []
        self.hover_annotation = None
        self.hover_marker: Line2D | None = None
        self.hover_vline: Line2D | None = None
        self.hover_alpha = 0.0
        self.hover_target_alpha = 0.0
        self.hover_animation_after_id: str | None = None
        self.active_hover_key: tuple[Any, Any, Any] | None = None

        self._build_ui()
        self._restore_settings()
        self._load_data_and_plot(initial=True)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        container = ttk.Frame(self.root, padding=10)
        container.pack(fill="both", expand=True)

        controls = ttk.LabelFrame(container, text="Data and Plot Controls", padding=8)
        controls.pack(fill="x")

        ttk.Label(controls, text="JSON file:").grid(row=0, column=0, sticky="w")
        self.path_entry = ttk.Entry(controls, textvariable=self.json_path, width=95)
        self.path_entry.grid(row=0, column=1, columnspan=6, sticky="ew", padx=6)

        ttk.Button(controls, text="Browse", command=self._browse_json).grid(row=0, column=7, padx=4)
        ttk.Button(controls, text="Reload", command=self._load_data_and_plot).grid(row=0, column=8, padx=4)
        ttk.Button(controls, text="Export PNG", command=self._export_png).grid(row=0, column=9, padx=4)

        ttk.Label(controls, text="X-axis:").grid(row=1, column=0, sticky="w", pady=(8, 0))
        x_combo = ttk.Combobox(controls, values=X_MODES, textvariable=self.x_mode, width=16, state="readonly")
        x_combo.grid(row=1, column=1, sticky="w", pady=(8, 0), padx=6)
        x_combo.bind("<<ComboboxSelected>>", lambda _: self._plot())

        ttk.Label(controls, text="Moving avg window:").grid(row=1, column=2, sticky="w", pady=(8, 0))
        ma_spin = ttk.Spinbox(controls, from_=1, to=100, textvariable=self.ma_window, width=7, command=self._plot)
        ma_spin.grid(row=1, column=3, sticky="w", pady=(8, 0), padx=6)

        ttk.Checkbutton(
            controls,
            text="Normalize selected metrics (0..1)",
            variable=self.normalize_enabled,
            command=self._plot,
        ).grid(row=1, column=4, columnspan=2, sticky="w", pady=(8, 0), padx=6)

        ttk.Checkbutton(
            controls,
            text="Use only last record per game_date",
            variable=self.unique_game_date_only,
            command=self._plot,
        ).grid(row=1, column=6, columnspan=2, sticky="w", pady=(8, 0), padx=6)

        ttk.Checkbutton(
            controls,
            text="Separate Y scale per metric",
            variable=self.separate_scale_enabled,
            command=self._plot,
        ).grid(row=1, column=8, columnspan=2, sticky="w", pady=(8, 0), padx=6)

        tabs = ttk.Notebook(container)
        tabs.pack(fill="x", pady=(10, 10))

        metrics_tab = ttk.Frame(tabs, padding=8)
        presets_tab = ttk.Frame(tabs, padding=8)
        tabs.add(metrics_tab, text="Metrics")
        tabs.add(presets_tab, text="Presets")

        metrics_frame = ttk.LabelFrame(metrics_tab, text="Manual Metric Selection", padding=8)
        metrics_frame.pack(fill="x")

        max_cols = 4
        for idx, metric in enumerate(NUMERIC_METRICS):
            row = idx // max_cols
            col = idx % max_cols
            var = tk.BooleanVar(value=metric in {"write_duration_seconds", "cpu_avg", "ram_avg"})
            self.metric_vars[metric] = var
            ttk.Checkbutton(metrics_frame, text=metric, variable=var, command=self._plot).grid(
                row=row,
                column=col,
                sticky="w",
                padx=8,
                pady=2,
            )

        presets_frame = ttk.LabelFrame(presets_tab, text="One-click Presets", padding=8)
        presets_frame.pack(fill="x")

        self.preset_info_var = tk.StringVar(value="Choose a preset to auto-configure the graph.")
        ttk.Label(presets_frame, textvariable=self.preset_info_var, anchor="w").grid(
            row=0,
            column=0,
            columnspan=3,
            sticky="w",
            pady=(0, 8),
        )

        for idx, name in enumerate(PRESETS):
            row = idx + 1
            ttk.Button(
                presets_frame,
                text=name,
                command=lambda n=name: self._apply_preset(n),
                width=18,
            ).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=4)

            ttk.Label(
                presets_frame,
                text=PRESETS[name]["description"],
            ).grid(row=row, column=1, columnspan=2, sticky="w", pady=4)

        ttk.Button(
            presets_frame,
            text="Reset to default metrics",
            command=self._reset_default_metrics,
        ).grid(row=len(PRESETS) + 2, column=0, sticky="w", pady=(10, 2))

        plot_frame = ttk.LabelFrame(container, text="Graph", padding=8)
        plot_frame.pack(fill="both", expand=True)

        self.figure = Figure(figsize=(12, 6), dpi=100)
        self.ax = self.figure.add_subplot(111)

        self.canvas = FigureCanvasTkAgg(self.figure, master=plot_frame)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)
        self.canvas.mpl_connect("motion_notify_event", self._on_plot_hover)
        self.canvas.mpl_connect("figure_leave_event", self._on_figure_leave)
        self._create_hover_artists()

        toolbar = NavigationToolbar2Tk(self.canvas, plot_frame)
        toolbar.update()

        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(container, textvariable=self.status_var, anchor="w").pack(fill="x", pady=(4, 0))

        for i in range(10):
            controls.columnconfigure(i, weight=1 if i == 1 else 0)

    def _browse_json(self) -> None:
        selected = filedialog.askopenfilename(
            title="Select autosave JSON",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
            initialdir=os.path.dirname(self.json_path.get()) if self.json_path.get() else os.getcwd(),
        )
        if selected:
            self.json_path.set(selected)
            self._load_data_and_plot()

    def _load_json(self, path: str) -> list[dict[str, Any]]:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        records = payload.get("records", [])
        if not isinstance(records, list):
            raise ValueError("JSON field 'records' must be a list")

        return [r for r in records if isinstance(r, dict)]

    def _load_data_and_plot(self, initial: bool = False) -> None:
        path = self.json_path.get().strip()
        if not path:
            if initial:
                return
            messagebox.showerror("Error", "JSON path is empty")
            return

        if not os.path.exists(path):
            if initial:
                self.status_var.set(f"JSON not found: {path}")
                return
            messagebox.showerror("Error", f"JSON file not found:\n{path}")
            return

        try:
            records = self._load_json(path)
        except Exception as exc:  # pylint: disable=broad-except
            messagebox.showerror("Error", f"Failed to read JSON:\n{exc}")
            return

        self.parsed = ParsedData(records=records, source_path=path)
        self.status_var.set(f"Loaded {len(records)} records from {path}")
        self._plot()

    def _records_for_plot(self) -> list[dict[str, Any]]:
        records = self.parsed.records

        if not self.unique_game_date_only.get():
            return records

        by_date: dict[str, dict[str, Any]] = {}
        no_date_records: list[dict[str, Any]] = []

        for rec in records:
            game_date = rec.get("game_date")
            if not game_date:
                no_date_records.append(rec)
                continue
            by_date[str(game_date)] = rec

        sorted_dated = sorted(
            by_date.values(),
            key=lambda r: self._parse_real_time(r.get("real_time")) or datetime.min,
        )

        return no_date_records + sorted_dated

    @staticmethod
    def _parse_real_time(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    @staticmethod
    def _parse_game_date_to_number(value: Any) -> float | None:
        if not isinstance(value, str):
            return None

        parts = value.split(".")
        if len(parts) < 3:
            return None

        try:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])
        except ValueError:
            return None

        return float(year * 360 + month * 30 + day)

    @staticmethod
    def _moving_average(values: list[float], window: int) -> list[float]:
        if window <= 1:
            return values[:]

        out: list[float] = []
        rolling_sum = 0.0

        for idx, val in enumerate(values):
            rolling_sum += val
            if idx >= window:
                rolling_sum -= values[idx - window]
            denom = min(window, idx + 1)
            out.append(rolling_sum / denom)

        return out

    @staticmethod
    def _normalize(values: list[float]) -> list[float]:
        if not values:
            return values
        v_min = min(values)
        v_max = max(values)
        if v_max == v_min:
            return [0.5 for _ in values]
        return [(v - v_min) / (v_max - v_min) for v in values]

    def _build_x_axis(self, records: list[dict[str, Any]]) -> tuple[list[float], list[str], str]:
        mode = self.x_mode.get()

        if mode == "save_index":
            xs = [float(i + 1) for i in range(len(records))]
            labels = [str(i + 1) for i in range(len(records))]
            return xs, labels, "Save index"

        if mode == "real_time":
            xs: list[float] = []
            labels: list[str] = []
            for i, rec in enumerate(records):
                dt = self._parse_real_time(rec.get("real_time"))
                if dt is None:
                    xs.append(float(i + 1))
                    labels.append(str(i + 1))
                else:
                    xs.append(dt.timestamp())
                    labels.append(dt.strftime("%H:%M:%S"))
            return xs, labels, "Real time"

        xs = []
        labels = []
        for i, rec in enumerate(records):
            gd = rec.get("game_date")
            num = self._parse_game_date_to_number(gd)
            if num is None:
                xs.append(float(i + 1))
                labels.append(str(i + 1))
            else:
                xs.append(num)
                labels.append(str(gd))
        return xs, labels, "Game date"

    def _plot(self) -> None:
        records = self._records_for_plot()
        selected_metrics = [m for m, var in self.metric_vars.items() if var.get()]
        separate_scale = self.separate_scale_enabled.get() and not self.normalize_enabled.get()

        self.ax.clear()
        self.hover_points = []
        self.active_hover_key = None
        self.hover_alpha = 0.0
        self.hover_target_alpha = 0.0
        self._create_hover_artists()
        if hasattr(self, "extra_axes"):
            for extra_ax in self.extra_axes:
                extra_ax.remove()
        self.extra_axes: list[Any] = []

        if not records:
            self.ax.set_title("No records available")
            self.ax.grid(True, alpha=0.3)
            self.canvas.draw_idle()
            self.status_var.set("No records to plot")
            return

        if not selected_metrics:
            self.ax.set_title("Select at least one metric")
            self.ax.grid(True, alpha=0.3)
            self.canvas.draw_idle()
            self.status_var.set("No metrics selected")
            return

        xs, x_labels, x_name = self._build_x_axis(records)
        ma = max(1, int(self.ma_window.get()))
        normalize = self.normalize_enabled.get()

        lines_plotted = 0
        for metric_idx, metric in enumerate(selected_metrics):
            points: list[tuple[float, float, dict[str, Any]]] = []
            for x, rec in zip(xs, records):
                value = rec.get(metric)
                if isinstance(value, (int, float)):
                    points.append((x, float(value), rec))

            if not points:
                continue

            x_vals = [p[0] for p in points]
            raw_y_vals = [p[1] for p in points]
            y_vals = self._moving_average(raw_y_vals, ma)

            if normalize:
                y_vals = self._normalize(y_vals)

            target_ax = self.ax
            if separate_scale and metric_idx > 0:
                target_ax = self.ax.twinx()
                target_ax.spines["right"].set_position(("outward", 48 * (metric_idx - 1)))
                self.extra_axes.append(target_ax)

            line_list = target_ax.plot(x_vals, y_vals, marker="o", linewidth=1.5, markersize=3.5, label=metric)
            line = line_list[0]
            line_color = line.get_color()

            if separate_scale:
                target_ax.set_ylabel(metric, color=line_color)
                target_ax.tick_params(axis="y", colors=line_color)
                target_ax.spines["right"].set_color(line_color)
                target_ax.grid(False)

            for idx, (x_val, raw_y, rec) in enumerate(points):
                self.hover_points.append(
                    {
                        "metric": metric,
                        "x": x_val,
                        "y": y_vals[idx],
                        "raw_y": raw_y,
                        "record": rec,
                        "x_label": self._point_x_label(x_name, x_labels, x_val, rec),
                        "display_y": y_vals[idx],
                        "normalized": normalize,
                        "ax": target_ax,
                    }
                )
            lines_plotted += 1

        self.ax.set_xlabel(x_name)
        self.ax.set_ylabel("Normalized value" if normalize else "Metric value")
        self.ax.grid(True, alpha=0.35)

        if lines_plotted > 0:
            if separate_scale:
                handles = []
                labels = []
                for axis in [self.ax, *self.extra_axes]:
                    axis_handles, axis_labels = axis.get_legend_handles_labels()
                    handles.extend(axis_handles)
                    labels.extend(axis_labels)
                self.ax.legend(handles, labels, loc="best")
            else:
                self.ax.legend(loc="best")
            self.ax.set_title("HOI4 autosave metrics")
        else:
            self.ax.set_title("No numeric data in selected metrics")

        if len(xs) <= 35:
            self.ax.set_xticks(xs)
            self.ax.set_xticklabels(x_labels, rotation=40, ha="right")

        self.figure.tight_layout()
        self.canvas.draw_idle()

        suffix = " (unique game_date)" if self.unique_game_date_only.get() else ""
        scale_note = "; separate-scale" if separate_scale else ""
        self.status_var.set(
            f"Plotted {lines_plotted} metric(s) on {len(records)} record(s){suffix}; MA={ma}, normalize={normalize}{scale_note}"
        )
        self._save_settings(silent=True)

    @staticmethod
    def _format_metric_value(value: Any) -> str:
        if isinstance(value, float):
            return f"{value:.2f}"
        return str(value)

    def _point_x_label(self, x_name: str, x_labels: list[str], x_value: float, record: dict[str, Any]) -> str:
        if x_name == "Save index":
            return str(int(x_value)) if float(x_value).is_integer() else str(x_value)
        if x_name == "Real time":
            return str(record.get("real_time") or "?")
        return str(record.get("game_date") or "?")

    def _build_hover_text(self, point: dict[str, Any]) -> str:
        record = point["record"]
        lines = [
            f"metric: {point['metric']}",
            f"value: {self._format_metric_value(point['raw_y'])}",
        ]

        if point["normalized"]:
            lines.append(f"plot value: {self._format_metric_value(point['display_y'])}")

        lines.extend(
            [
                f"game_date: {record.get('game_date', '?')}",
                f"real_time: {record.get('real_time', '?')}",
                f"file_size_mb: {self._format_metric_value(record.get('file_size_mb', '?'))}",
                f"write_duration: {self._format_metric_value(record.get('write_duration_seconds', '?'))}",
            ]
        )
        return "\n".join(lines)

    def _hide_hover_annotation(self) -> None:
        self.hover_target_alpha = 0.0
        self.active_hover_key = None
        self._schedule_hover_animation()

    def _on_figure_leave(self, _event: Any) -> None:
        self._hide_hover_annotation()

    def _on_plot_hover(self, event: Any) -> None:
        if event.inaxes != self.ax or event.x is None or event.y is None or not self.hover_points:
            self._hide_hover_annotation()
            return

        nearest_point = None
        nearest_distance = None
        for point in self.hover_points:
            point_ax = point.get("ax", self.ax)
            px, py = point_ax.transData.transform((point["x"], point["y"]))
            distance = ((px - event.x) ** 2 + (py - event.y) ** 2) ** 0.5
            if nearest_distance is None or distance < nearest_distance:
                nearest_distance = distance
                nearest_point = point

        if nearest_point is None or nearest_distance is None or nearest_distance > 18:
            self._hide_hover_annotation()
            return

        hover_key = (nearest_point["metric"], nearest_point["x"], nearest_point["y"])
        if hover_key != self.active_hover_key:
            self.active_hover_key = hover_key
            self._update_hover_artists(nearest_point)

        self.hover_annotation.xy = (nearest_point["x"], nearest_point["y"])
        self.hover_annotation.set_text(self._build_hover_text(nearest_point))
        self.hover_target_alpha = 1.0
        self._schedule_hover_animation()

    def _create_hover_artists(self) -> None:
        self.hover_annotation = self.ax.annotate(
            "",
            xy=(0, 0),
            xytext=(14, 14),
            textcoords="offset points",
            bbox={"boxstyle": "round,pad=0.4", "facecolor": "#fff8dc", "edgecolor": "#666666", "alpha": 0.0},
            arrowprops={"arrowstyle": "->", "color": "#666666", "lw": 0.8, "alpha": 0.0},
            zorder=6,
        )
        self.hover_annotation.set_visible(False)
        self.hover_marker, = self.ax.plot([], [], marker="o", markersize=9, linestyle="", color="#d1495b", zorder=7)
        self.hover_marker.set_visible(False)
        self.hover_vline = self.ax.axvline(0, color="#d1495b", linestyle="--", linewidth=1.0, alpha=0.0, zorder=1)
        self.hover_vline.set_visible(False)

    def _update_hover_artists(self, point: dict[str, Any]) -> None:
        self.hover_annotation.xy = (point["x"], point["y"])
        self.hover_annotation.set_text(self._build_hover_text(point))
        self.hover_annotation.set_visible(True)

        if self.hover_marker is not None:
            self.hover_marker.set_data([point["x"]], [point["y"]])
            self.hover_marker.set_visible(True)

        if self.hover_vline is not None:
            self.hover_vline.set_xdata([point["x"], point["x"]])
            self.hover_vline.set_visible(True)

    def _set_hover_alpha(self, alpha: float) -> None:
        alpha = max(0.0, min(1.0, alpha))
        self.hover_alpha = alpha

        if self.hover_annotation is not None:
            self.hover_annotation.set_alpha(alpha)
            bbox_patch = self.hover_annotation.get_bbox_patch()
            if bbox_patch is not None:
                bbox_patch.set_alpha(0.95 * alpha)
            arrow_patch = self.hover_annotation.arrow_patch
            if arrow_patch is not None:
                arrow_patch.set_alpha(alpha)
            self.hover_annotation.set_visible(alpha > 0.01)

        if self.hover_marker is not None:
            self.hover_marker.set_alpha(alpha)
            self.hover_marker.set_visible(alpha > 0.01 and self.active_hover_key is not None)

        if self.hover_vline is not None:
            self.hover_vline.set_alpha(0.55 * alpha)
            self.hover_vline.set_visible(alpha > 0.01 and self.active_hover_key is not None)

    def _schedule_hover_animation(self) -> None:
        if self.hover_animation_after_id is None:
            self.hover_animation_after_id = self.root.after(16, self._animate_hover)

    def _animate_hover(self) -> None:
        self.hover_animation_after_id = None
        delta = self.hover_target_alpha - self.hover_alpha
        if abs(delta) < 0.05:
            self._set_hover_alpha(self.hover_target_alpha)
            if self.hover_target_alpha == 0.0:
                if self.hover_annotation is not None:
                    self.hover_annotation.set_visible(False)
                if self.hover_marker is not None:
                    self.hover_marker.set_visible(False)
                if self.hover_vline is not None:
                    self.hover_vline.set_visible(False)
            self.canvas.draw_idle()
            return

        step = 0.18 if delta > 0 else -0.18
        self._set_hover_alpha(self.hover_alpha + step)
        self.canvas.draw_idle()
        self._schedule_hover_animation()

    def _set_selected_metrics(self, metrics: list[str]) -> None:
        wanted = set(metrics)
        for metric, var in self.metric_vars.items():
            var.set(metric in wanted)

    def _apply_preset(self, preset_name: str) -> None:
        preset = PRESETS.get(preset_name)
        if not preset:
            return

        self._set_selected_metrics(preset["metrics"])
        self.x_mode.set(preset["x_mode"])
        self.ma_window.set(int(preset["ma_window"]))
        self.normalize_enabled.set(bool(preset["normalize"]))
        self.unique_game_date_only.set(bool(preset["unique_game_date_only"]))
        self.last_preset_name.set(preset_name)

        self.preset_info_var.set(f"Preset: {preset_name} - {preset['description']}")
        self._plot()

    def _reset_default_metrics(self) -> None:
        self._set_selected_metrics(["write_duration_seconds", "cpu_avg", "ram_avg"])
        self.x_mode.set("save_index")
        self.ma_window.set(1)
        self.normalize_enabled.set(False)
        self.unique_game_date_only.set(False)
        self.last_preset_name.set("")
        self.preset_info_var.set("Manual mode restored: write_duration_seconds, cpu_avg, ram_avg.")
        self._plot()

    def _build_settings_payload(self) -> dict[str, Any]:
        selected_metrics = [metric for metric, var in self.metric_vars.items() if var.get()]
        return {
            "json_path": self.json_path.get().strip(),
            "x_mode": self.x_mode.get(),
            "ma_window": int(self.ma_window.get()),
            "normalize_enabled": bool(self.normalize_enabled.get()),
            "unique_game_date_only": bool(self.unique_game_date_only.get()),
            "separate_scale_enabled": bool(self.separate_scale_enabled.get()),
            "selected_metrics": selected_metrics,
            "last_preset_name": self.last_preset_name.get().strip(),
            "saved_at": datetime.now().isoformat(timespec="seconds"),
        }

    def _save_settings(self, silent: bool = False) -> None:
        payload = self._build_settings_payload()
        try:
            with open(self.settings_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except OSError as exc:
            if not silent:
                messagebox.showwarning("Warning", f"Failed to save GUI settings:\n{exc}")

    def _restore_settings(self) -> None:
        if not os.path.exists(self.settings_path):
            return

        try:
            with open(self.settings_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError):
            return

        if not isinstance(payload, dict):
            return

        json_path = payload.get("json_path")
        if isinstance(json_path, str) and json_path.strip():
            self.json_path.set(json_path.strip())

        x_mode = payload.get("x_mode")
        if isinstance(x_mode, str) and x_mode in X_MODES:
            self.x_mode.set(x_mode)

        ma_window = payload.get("ma_window")
        if isinstance(ma_window, int):
            self.ma_window.set(max(1, min(ma_window, 100)))

        self.normalize_enabled.set(bool(payload.get("normalize_enabled", False)))
        self.unique_game_date_only.set(bool(payload.get("unique_game_date_only", False)))
        self.separate_scale_enabled.set(bool(payload.get("separate_scale_enabled", False)))

        selected_metrics = payload.get("selected_metrics")
        if isinstance(selected_metrics, list):
            cleaned = [m for m in selected_metrics if isinstance(m, str) and m in self.metric_vars]
            if cleaned:
                self._set_selected_metrics(cleaned)

        preset_name = payload.get("last_preset_name")
        if isinstance(preset_name, str) and preset_name in PRESETS:
            self.last_preset_name.set(preset_name)
            self.preset_info_var.set(f"Last preset: {preset_name} - {PRESETS[preset_name]['description']}")

    def _on_close(self) -> None:
        if self.hover_animation_after_id is not None:
            self.root.after_cancel(self.hover_animation_after_id)
            self.hover_animation_after_id = None
        self._save_settings(silent=True)
        self.root.destroy()

    def _export_png(self) -> None:
        path = filedialog.asksaveasfilename(
            title="Export graph to PNG",
            defaultextension=".png",
            filetypes=[("PNG image", "*.png")],
            initialfile="hoi4_autosave_graph.png",
        )
        if not path:
            return

        try:
            self.figure.savefig(path, dpi=140)
        except Exception as exc:  # pylint: disable=broad-except
            messagebox.showerror("Error", f"Failed to save PNG:\n{exc}")
            return

        self.status_var.set(f"Saved graph to {path}")


def main() -> None:
    root = tk.Tk()
    app = GraphApp(root)
    root.minsize(1024, 700)
    root.mainloop()


if __name__ == "__main__":
    main()
