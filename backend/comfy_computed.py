"""Recompute the outputs of ComfyUI core nodes that derive numbers from their inputs.

Each mirrors the node's own code (``comfy_extras/nodes_resolution.py`` and ``nodes_math.py``),
so a value shown or compared is the one the node produced. Anything outside what is mirrored
returns None rather than a guess.
"""

from __future__ import annotations

import ast
import math
import operator
from collections.abc import Callable, Mapping
from typing import Any, TypeIs

_ASPECT_RATIOS = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}

_MAX_EXPRESSION_CHARS = 2000
_MAX_EXPONENT = 4000

type Number = int | float


def resolution_selector(
    aspect_ratio: object, megapixels: object, multiple: object
) -> tuple[int, int] | None:
    """``(width, height)`` as ResolutionSelector computes them."""
    ratio = _ASPECT_RATIOS.get(aspect_ratio) if isinstance(aspect_ratio, str) else None
    if (
        ratio is None
        or not _is_number(megapixels)
        or not _is_number(multiple)
        or megapixels <= 0
        or multiple <= 0
    ):
        return None
    w_ratio, h_ratio = ratio
    scale = math.sqrt(megapixels * 1024 * 1024 / (w_ratio * h_ratio))
    return (
        int(round(w_ratio * scale / multiple) * multiple),
        int(round(h_ratio * scale / multiple) * multiple),
    )


def _is_number(value: object) -> TypeIs[Number]:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _safe_pow(base: Number, exponent: Number) -> Number:
    if abs(exponent) > _MAX_EXPONENT:
        raise ValueError("exponent too large")
    return pow(base, exponent)


def _variadic_sum(*args: Any) -> Any:
    """``sum(values)`` and ``sum(a, b, c)`` alike."""
    if len(args) == 1 and isinstance(args[0], list | tuple):
        return sum(args[0])
    return sum(args)


_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "sum": _variadic_sum,
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "pow": _safe_pow,
    "sqrt": math.sqrt,
    "ceil": math.ceil,
    "floor": math.floor,
    "log": math.log,
    "log2": math.log2,
    "log10": math.log10,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "int": int,
    "float": float,
}

_BINARY: dict[type[ast.operator], Callable[..., Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: _safe_pow,
}

_UNARY: dict[type[ast.unaryop], Callable[..., Any]] = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _evaluate(node: ast.AST, names: Mapping[str, object]) -> object:
    if isinstance(node, ast.Constant) and (_is_number(node.value) or isinstance(node.value, bool)):
        return node.value
    if isinstance(node, ast.Name) and node.id in names:
        return names[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        return _BINARY[type(node.op)](_evaluate(node.left, names), _evaluate(node.right, names))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_evaluate(node.operand, names))
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _FUNCTIONS
        and not node.keywords
    ):
        return _FUNCTIONS[node.func.id](*(_evaluate(arg, names) for arg in node.args))
    raise ValueError("unsupported expression")


def math_expression(expression: object, values: Mapping[str, object]) -> Number | None:
    """The numeric result ComfyMathExpression computes, before it is split into its outputs."""
    if not isinstance(expression, str) or not expression.strip():
        return None
    if len(expression) > _MAX_EXPRESSION_CHARS:
        return None
    names: dict[str, object] = {**values, "values": list(values.values())}
    try:
        result = _evaluate(ast.parse(expression.strip(), mode="eval").body, names)
    except (ValueError, TypeError, ZeroDivisionError, OverflowError, SyntaxError, RecursionError):
        return None
    if isinstance(result, bool) or not _is_number(result):
        return None
    return result if math.isfinite(result) else None


def math_expression_output(result: Number, slot: int) -> Number | bool | None:
    """ComfyMathExpression's outputs: FLOAT, INT (truncated) and BOOL."""
    if slot == 0:
        return float(result)
    if slot == 1:
        return int(result)
    if slot == 2:
        return bool(result)
    return None
