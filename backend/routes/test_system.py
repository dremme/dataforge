"""Tests for /api/system/specs."""

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
            memory_available_bytes=24 * 1024**3,
            gpu_name="NVIDIA GeForce RTX 3080",
            gpu_memory_bytes=10 * 1024**3,
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
                "memory_available_bytes": 24 * 1024**3,
                "gpu_name": "NVIDIA GeForce RTX 3080",
                "gpu_memory_bytes": 10 * 1024**3,
                "gpu_available": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
