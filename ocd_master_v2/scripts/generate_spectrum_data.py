#!/usr/bin/env python3
"""
Synthetic OCD spectrum CSV generator.

Model summary:
- Wavelength grid: 190 to 1000 nm, step 0.8 nm (fixed length across files)
- Signal = smooth baseline + interference fringes + absorption features + noise
- Per-wafer parameters introduce process variation; per-spectrum jitter adds repeatability spread
- Channels N/C/S are correlated but not identical (phase/scale offsets + correlated noise)

Usage:
  python ocd_master/scripts/generate_spectrum_data.py --out ocd_master/spectrum_data --n_files 20 --seed 42
"""
from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

import numpy as np
import pandas as pd


def format_wafer_id(index: int) -> str:
    return f"WAFER_{index:04d}"


def format_spectrum_id(index: int) -> str:
    return f"SPEC_{index:04d}"


def build_wavelengths() -> np.ndarray:
    return np.arange(190.0, 1000.0, 0.8)


def sample_wafer_params(rng: np.random.Generator) -> dict:
    return {
        "baseline_offset": rng.uniform(0.9, 1.4),
        "baseline_slope": rng.uniform(-0.12, 0.12),
        "baseline_curve": rng.uniform(-0.08, 0.08),
        "fringe_amp_1": rng.uniform(0.02, 0.08),
        "fringe_amp_2": rng.uniform(0.01, 0.05),
        "fringe_period_1": rng.uniform(45.0, 80.0),
        "fringe_period_2": rng.uniform(90.0, 160.0),
        "fringe_phase_1": rng.uniform(0, 2 * np.pi),
        "fringe_phase_2": rng.uniform(0, 2 * np.pi),
        "abs_centers": rng.uniform(230.0, 760.0, size=3),
        "abs_widths": rng.uniform(18.0, 60.0, size=3),
        "abs_depths": rng.uniform(0.02, 0.12, size=3),
        "noise_level": rng.uniform(0.004, 0.012)
    }


def generate_base_signal(
    wavelengths: np.ndarray,
    params: dict,
    jitter: dict
) -> np.ndarray:
    norm = (wavelengths - 550.0) / 450.0
    baseline = (
        params["baseline_offset"]
        + (params["baseline_slope"] + jitter["baseline_slope"]) * norm
        + (params["baseline_curve"] + jitter["baseline_curve"]) * norm**2
    )

    fringes = (
        (params["fringe_amp_1"] + jitter["fringe_amp_1"])
        * np.sin(2 * np.pi * wavelengths / (params["fringe_period_1"] + jitter["fringe_period_1"]) + params["fringe_phase_1"])
        + (params["fringe_amp_2"] + jitter["fringe_amp_2"])
        * np.sin(2 * np.pi * wavelengths / (params["fringe_period_2"] + jitter["fringe_period_2"]) + params["fringe_phase_2"])
    )

    absorption = np.zeros_like(wavelengths)
    for center, width, depth in zip(params["abs_centers"], params["abs_widths"], params["abs_depths"]):
        absorption += depth * np.exp(-0.5 * ((wavelengths - center) / width) ** 2)

    return baseline + fringes - absorption


def generate_channels(
    wavelengths: np.ndarray,
    params: dict,
    rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    jitter = {
        "baseline_slope": rng.uniform(-0.02, 0.02),
        "baseline_curve": rng.uniform(-0.02, 0.02),
        "fringe_amp_1": rng.uniform(-0.01, 0.01),
        "fringe_amp_2": rng.uniform(-0.008, 0.008),
        "fringe_period_1": rng.uniform(-4.0, 4.0),
        "fringe_period_2": rng.uniform(-6.0, 6.0)
    }
    base = generate_base_signal(wavelengths, params, jitter)

    phase_shift = rng.uniform(-0.3, 0.3)
    fringe_comp = 0.015 * np.sin(2 * np.pi * wavelengths / params["fringe_period_1"] + params["fringe_phase_1"] + phase_shift)

    shared_noise = rng.normal(0.0, params["noise_level"], size=wavelengths.size)
    noise_c = rng.normal(0.0, params["noise_level"] * 0.6, size=wavelengths.size)
    noise_s = rng.normal(0.0, params["noise_level"] * 0.6, size=wavelengths.size)
    noise_n = rng.normal(0.0, params["noise_level"] * 0.5, size=wavelengths.size)

    c_channel = base * (1.0 + rng.uniform(-0.02, 0.02)) + fringe_comp + shared_noise + noise_c
    s_channel = base * (0.98 + rng.uniform(-0.015, 0.015)) - 0.6 * fringe_comp + shared_noise + noise_s
    n_channel = base * (1.03 + rng.uniform(-0.015, 0.015)) + 0.4 * fringe_comp + shared_noise + noise_n

    return n_channel, c_channel, s_channel


def generate_for_wafer(
    wafer_id: str,
    out_dir: Path,
    n_files: int,
    rng: np.random.Generator
) -> None:
    wavelengths = build_wavelengths()
    wafer_params = sample_wafer_params(rng)

    wafer_dir = out_dir / wafer_id / "spectrum"
    wafer_dir.mkdir(parents=True, exist_ok=True)

    for index in range(1, n_files + 1):
        spectrum_id = format_spectrum_id(index)
        n_channel, c_channel, s_channel = generate_channels(wavelengths, wafer_params, rng)
        df = pd.DataFrame(
            {
                "Wavelength": wavelengths,
                "N": n_channel,
                "C": c_channel,
                "S": s_channel
            }
        )
        df.to_csv(wafer_dir / f"{spectrum_id}.csv", index=False, float_format="%.6f")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate synthetic OCD spectrum CSVs.")
    parser.add_argument("--out", required=True, help="Output directory, e.g. ocd_master/spectrum_data")
    parser.add_argument("--n_files", type=int, default=20, help="Number of spectra files per wafer")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--wafer_count", type=int, default=500, help="Number of wafers to generate")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output directory")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out)

    if out_dir.exists() and any(out_dir.iterdir()):
        if not args.force:
            raise SystemExit(
                f"Output directory {out_dir} is not empty. Re-run with --force to overwrite."
            )
        shutil.rmtree(out_dir)

    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(args.seed)
    for wafer_index in range(1, args.wafer_count + 1):
        wafer_id = format_wafer_id(wafer_index)
        generate_for_wafer(wafer_id, out_dir, args.n_files, rng)


if __name__ == "__main__":
    main()
