from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from schemas import ServiceProbeRequest
from service_probe import probe_service
from testing_fixtures import forget_saved_settings, isolate_test_database

isolate_test_database()

_real_client = httpx.Client


def serving(handler):
    """Routes the probe's client to ``handler`` while keeping the base URL it was given."""

    def make_client(*_args: object, base_url: str = "", **kwargs: object) -> httpx.Client:
        return _real_client(
            base_url=base_url,
            headers=kwargs.get("headers"),
            transport=httpx.MockTransport(handler),
        )

    return patch("service_probe.httpx.Client", make_client)


class ProbeTests(unittest.TestCase):
    def tearDown(self) -> None:
        forget_saved_settings()

    def test_the_vision_server_lists_its_models(self) -> None:
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"data": [{"id": "qwen38"}, {"id": "gemma4"}]})

        with serving(handler):
            result = probe_service(
                ServiceProbeRequest(
                    service="vision", base_url="http://127.0.0.1:8888/v1/", api_key="sk-test"
                )
            )

        self.assertTrue(result.reachable)
        self.assertEqual(result.models, ["gemma4", "qwen38"])
        self.assertEqual(str(seen[0].url), "http://127.0.0.1:8888/v1/models")
        self.assertEqual(seen[0].headers["Authorization"], "Bearer sk-test")

    def test_without_a_typed_key_the_key_in_force_is_sent(self) -> None:
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"data": []})

        with serving(handler), patch.dict("os.environ", {"OPENAI_API_KEY": "sk-env"}):
            probe_service(
                ServiceProbeRequest(service="vision", base_url="http://127.0.0.1:8888/v1")
            )

        self.assertEqual(seen[0].headers["Authorization"], "Bearer sk-env")

    def test_a_refused_key_says_so_without_repeating_it(self) -> None:
        with serving(lambda _request: httpx.Response(401)):
            result = probe_service(
                ServiceProbeRequest(
                    service="vision", base_url="http://127.0.0.1:8888/v1", api_key="sk-wrong"
                )
            )

        self.assertFalse(result.reachable)
        self.assertEqual(result.detail, "HTTP 401: check the API key")
        self.assertNotIn("sk-wrong", result.model_dump_json())

    def test_an_unreachable_service_reads_as_refused(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        with serving(handler):
            result = probe_service(
                ServiceProbeRequest(service="comfy", base_url="http://127.0.0.1:9000")
            )

        self.assertFalse(result.reachable)
        self.assertEqual(result.detail, "Connection refused")

    def test_each_integration_is_asked_its_health_path(self) -> None:
        paths: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            paths.append(request.url.path)
            return httpx.Response(200, json={})

        with serving(handler):
            for service in ("comfy", "ai_toolkit"):
                result = probe_service(
                    ServiceProbeRequest(service=service, base_url="http://127.0.0.1:9000")
                )
                self.assertTrue(result.reachable)
                self.assertEqual(result.models, [])

        self.assertEqual(paths, ["/system_stats", "/api/gpu"])

    def test_an_unusable_url_is_refused_before_any_request(self) -> None:
        with self.assertRaises(ValueError):
            probe_service(ServiceProbeRequest(service="comfy", base_url="localhost:9000"))


if __name__ == "__main__":
    unittest.main()
