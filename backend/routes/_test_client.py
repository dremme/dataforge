from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from testing_fixtures import isolate_test_database

isolate_test_database()

# A loopback base URL: the request guard refuses TestClient's default "testserver" host.
client = TestClient(app, base_url="http://127.0.0.1")
