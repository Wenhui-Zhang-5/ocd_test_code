import random
from typing import Dict, List

from fastapi import APIRouter

router = APIRouter()


def seed_from_model_id(model_id: str) -> int:
    return sum(ord(ch) for ch in model_id) % 10_000


def build_basis(rng: random.Random) -> List[Dict]:
    pool = ["CD_TOP", "CD_BOTTOM", "CD_MID", "CD_SIDE", "CD_CENTER"]
    count = rng.randint(2, 4)
    names = pool[:count]
    basis = []
    for name in names:
        nominal = round(rng.uniform(24.0, 40.0), 2)
        min_val = round(nominal * 0.9, 2)
        max_val = round(nominal * 1.1, 2)
        basis.append(
            {
                "alias": name,
                "custom_name": name.replace("CD_", "").replace("_", " ").title() + " CD",
                "name": name,
                "float": rng.choice([True, False]),
                "nominal": nominal,
                "nominalNew": nominal,
                "min": min_val,
                "max": max_val,
            }
        )
    return basis


def build_constraints(rng: random.Random, basis: List[Dict]) -> List[Dict]:
    if len(basis) < 2:
        return []
    a, b = basis[0]["name"], basis[1]["name"]
    nominal = round((basis[0]["nominal"] + basis[1]["nominal"]) / 2, 2)
    return [
        {
            "alias": "CD_MID",
            "equation": f"0.5*{a} + 0.5*{b}",
            "nominal": nominal,
            "nominalNew": nominal,
        }
    ]


def build_materials(rng: random.Random) -> List[Dict]:
    mat = []
    for osc_index in range(1, 4):
        base_amp = rng.uniform(0.5, 1.3)
        base_en = rng.uniform(3.0, 5.5)
        base_eg = rng.uniform(1.0, 3.0)
        base_phi = rng.uniform(0.05, 0.15)
        base_nu = rng.uniform(0.15, 0.35)
        mat.extend(
            [
                {
                    "material": "Si_HO",
                    "model": f"HarmonicsOSC_{osc_index}",
                    "name": "Amp",
                    "value": round(base_amp, 3),
                    "valueNew": round(base_amp, 3),
                    "float": True,
                },
                {
                    "material": "Si_HO",
                    "model": f"HarmonicsOSC_{osc_index}",
                    "name": "En",
                    "value": round(base_en, 3),
                    "valueNew": round(base_en, 3),
                    "float": True,
                },
                {
                    "material": "Si_HO",
                    "model": f"HarmonicsOSC_{osc_index}",
                    "name": "Eg",
                    "value": round(base_eg, 3),
                    "valueNew": round(base_eg, 3),
                    "float": True,
                },
                {
                    "material": "Si_HO",
                    "model": f"HarmonicsOSC_{osc_index}",
                    "name": "Phi",
                    "value": round(base_phi, 3),
                    "valueNew": round(base_phi, 3),
                    "float": False,
                },
                {
                    "material": "Si_HO",
                    "model": f"HarmonicsOSC_{osc_index}",
                    "name": "Nu",
                    "value": round(base_nu, 3),
                    "valueNew": round(base_nu, 3),
                    "float": False,
                },
            ]
        )
    mat.extend(
        [
            {
                "material": "SiO2_Cauchy",
                "model": "Cauchy",
                "name": "A",
                "value": 1.46,
                "valueNew": 1.46,
                "float": False,
            },
            {
                "material": "SiO2_Cauchy",
                "model": "Cauchy",
                "name": "B",
                "value": round(rng.uniform(0.002, 0.005), 4),
                "valueNew": round(rng.uniform(0.002, 0.005), 4),
                "float": False,
            },
            {
                "material": "SiO2_Cauchy",
                "model": "Cauchy",
                "name": "C",
                "value": round(rng.uniform(0.00005, 0.0002), 5),
                "valueNew": round(rng.uniform(0.00005, 0.0002), 5),
                "float": False,
            },
            {
                "material": "SiO2_Cauchy",
                "model": "Cauchy",
                "name": "D",
                "value": 0.0,
                "valueNew": 0.0,
                "float": False,
            },
            {
                "material": "SiO2_Cauchy",
                "model": "Cauchy",
                "name": "F",
                "value": 0.0,
                "valueNew": 0.0,
                "float": False,
            },
            {
                "material": "SiO2_Cauchy",
                "model": "Cauchy",
                "name": "G",
                "value": 0.0,
                "valueNew": 0.0,
                "float": False,
            },
        ]
    )
    return mat


@router.get("/models/{model_id}")
def get_model(model_id: str):
    rng = random.Random(seed_from_model_id(model_id))
    basis = build_basis(rng)
    constraint = build_constraints(rng, basis)
    mat = build_materials(rng)
    proj_params = {
        "SEwavelength": [
            [190.0, 500.0, 1.0, 1.0],
            [500.0, 1000.0, 1.0, 2.0],
        ],
        "SESRRatio": round(rng.uniform(0.7, 0.95), 3),
    }
    return {"content": {"basis": basis, "constraint": constraint, "mat": mat, "proj_params": proj_params}}
