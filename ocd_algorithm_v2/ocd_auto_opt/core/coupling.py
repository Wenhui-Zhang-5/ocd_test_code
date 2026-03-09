from __future__ import annotations

import ast
from typing import Any, Dict, List

from ocd_algorithm_api.ocd_auto_opt.utils.model_utils import deep_copy_model, get_basis_rows, model_content


_ALLOWED_BIN_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a**b,
}

_ALLOWED_UNARY_OPS = {
    ast.UAdd: lambda a: +a,
    ast.USub: lambda a: -a,
}


def _safe_eval(expr: str, variables: Dict[str, float]) -> float:
    node = ast.parse(expr, mode="eval")

    def eval_node(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return eval_node(n.body)
        if isinstance(n, ast.Constant):
            return float(n.value)
        if isinstance(n, ast.Name):
            return float(variables.get(n.id, 0.0))
        if isinstance(n, ast.BinOp) and type(n.op) in _ALLOWED_BIN_OPS:
            return _ALLOWED_BIN_OPS[type(n.op)](eval_node(n.left), eval_node(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _ALLOWED_UNARY_OPS:
            return _ALLOWED_UNARY_OPS[type(n.op)](eval_node(n.operand))
        raise ValueError(f"unsupported expression node: {type(n).__name__}")

    return float(eval_node(node))


def apply_coupling(model_json: Dict[str, Any], coupling_expression: str) -> Dict[str, Any]:
    """
    Apply coupling expression(s) to model_json.

    Expression format examples:
      "CD_MID = 0.5*CD_TOP + 0.5*CD_BOTTOM"
      "CCD01 = CD01 - CD03; CCD02 = CD02 * 0.03"
    """
    out = deep_copy_model(model_json)
    expr = (coupling_expression or "").strip()
    if not expr:
        return out

    content = model_content(out)
    basis_raw = content.get("basis")
    if not isinstance(basis_raw, list):
        basis_raw = []
        content["basis"] = basis_raw
    basis = get_basis_rows(out)
    basis_map: Dict[str, Dict[str, Any]] = {}
    basis_value_map: Dict[str, float] = {}
    for row in basis:
        alias = str(row.get("alias") or row.get("name") or "").strip()
        if not alias:
            continue
        basis_map[alias] = row
        basis_value_map[alias] = float(row.get("nominalNew", row.get("nominal", 0.0)) or 0.0)

    constraints = content.get("constraint")
    if not isinstance(constraints, list):
        constraints = []
        content["constraint"] = constraints

    for raw_item in expr.split(";"):
        item = raw_item.strip()
        if not item or "=" not in item:
            continue

        lhs, rhs = item.split("=", 1)
        target = lhs.strip()
        formula = rhs.strip()
        if not target or not formula:
            continue

        # Update or append constraint row.
        existing = None
        for row in constraints:
            if not isinstance(row, dict):
                continue
            alias = str(row.get("alias") or row.get("name") or "").strip()
            if alias == target:
                existing = row
                break
        if existing is None:
            existing = {"alias": target}
            constraints.append(existing)

        existing["alias"] = target
        existing["equation"] = formula
        try:
            nominal = _safe_eval(formula, basis_value_map)
            existing["nominal"] = float(nominal)
            existing["nominalNew"] = float(nominal)
        except Exception:
            # Keep equation only when symbolic formula cannot be evaluated.
            pass

        # Remove redundant basis parameter if it is now defined by constraint.
        if target in basis_map and basis_map[target] in basis_raw:
            basis_raw.remove(basis_map[target])

    return out


def coupling_candidates(expressions: List[str]) -> List[str]:
    valid = [str(x).strip() for x in expressions if str(x).strip()]
    # Add empty coupling as baseline branch.
    return [""] + valid
