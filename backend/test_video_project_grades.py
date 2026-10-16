from __future__ import annotations

import unittest

from testing_fixtures import isolate_test_database

isolate_test_database()

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import router
from schemas import ColorAdjust
from video_project_grades import delete_grade, list_grades, save_grade


class GradeTests(unittest.TestCase):
    def setUp(self) -> None:
        for grade in list_grades():
            delete_grade(grade.id)

    def test_a_grade_saved_under_a_taken_name_replaces_it_and_keeps_its_id(self) -> None:
        first = save_grade("Dusk", ColorAdjust(warmth=0.3))
        save_grade("Bleach", ColorAdjust(saturation=-0.5))
        again = save_grade("dusk", ColorAdjust(warmth=0.6))

        grades = list_grades()
        self.assertEqual([grade.name for grade in grades], ["Bleach", "dusk"])
        self.assertEqual(again.id, first.id)
        self.assertEqual(grades[1].adjust.warmth, 0.6)

    def test_grades_round_trip_through_the_api(self) -> None:
        app = FastAPI()
        app.include_router(router)
        api = TestClient(app, base_url="http://127.0.0.1:8000")

        saved = api.post(
            "/api/video-projects/grades", json={"name": " Teal ", "adjust": {"tint": -0.2}}
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["name"], "Teal")
        listed = api.get("/api/video-projects/grades").json()["grades"]
        self.assertEqual([grade["adjust"]["tint"] for grade in listed], [-0.2])
        grade_id = saved.json()["id"]
        self.assertEqual(api.delete(f"/api/video-projects/grades/{grade_id}").status_code, 204)
        self.assertEqual(api.delete(f"/api/video-projects/grades/{grade_id}").status_code, 404)
        self.assertEqual(
            api.post("/api/video-projects/grades", json={"name": "", "adjust": {}}).status_code,
            422,
        )


if __name__ == "__main__":
    unittest.main()
