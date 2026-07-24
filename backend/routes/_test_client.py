"""Shared FastAPI test client for route endpoint tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from testing_fixtures import isolate_test_database

isolate_test_database()

client = TestClient(app)
