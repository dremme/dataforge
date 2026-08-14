"""Tests for /api/system/*."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from routes._test_client import client


class SystemSpecsEndpointTests(unittest.TestCase):
    @patch("routes.system.get_system_specs")
    def test_returns_system_specs(self, get_specs_mock) -> None:
        from system_specs import SystemSpecs

        get_specs_mock.return_value = SystemSpecs(
            cpu_name="Intel Core i7-12700K",
            cpu_cores=16,
            memory_total_bytes=32 * 1024**3,
            memory_used_bytes=8 * 1024**3,
            gpu_name="NVIDIA GeForce RTX 3080",
            gpu_memory_bytes=10 * 1024**3,
            gpu_memory_used_bytes=4 * 1024**3,
            gpu_available=True,
        )

        response = client.get("/api/system/specs")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "cpu_name": "Intel Core i7-12700K",
                "cpu_cores": 16,
                "memory_total_bytes": 32 * 1024**3,
                "memory_used_bytes": 8 * 1024**3,
                "gpu_name": "NVIDIA GeForce RTX 3080",
                "gpu_memory_bytes": 10 * 1024**3,
                "gpu_memory_used_bytes": 4 * 1024**3,
                "gpu_available": True,
            },
        )


class VisionLlmInfoEndpointTests(unittest.TestCase):
    @patch("routes.system.get_openai_model", return_value="qwen38")
    def test_returns_configured_model_id(self, _get_model_mock) -> None:
        response = client.get("/api/system/vision-llm")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"model": "qwen38"})


if __name__ == "__main__":
    unittest.main()
