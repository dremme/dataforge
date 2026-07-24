"""Tests for /api/health."""

from __future__ import annotations

import unittest

from routes._test_client import client


class HealthEndpointTests(unittest.TestCase):
    def test_returns_ok(self) -> None:
        response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
