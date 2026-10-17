/**
 * Named points on the timeline, for beats, lyric lines or shot notes. They are the project's own
 * and stay at their time whatever the clips do; edits that snap also snap to them.
 */
import type { VideoProjectMarker } from "@/shared/types";
import { EPSILON, newId, type EditResult, type Project } from "./timeline";

export type Marker = VideoProjectMarker;

function sorted(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.time - b.time);
}

/** A marker at ``time``, which is already on the frame grid; one frame holds one marker. */
export function addMarker(
  project: Project,
  time: number,
  name = "",
): EditResult & { marker?: Marker } {
  const halfFrame = 0.5 / project.frame_rate;
  if (project.markers.some((marker) => Math.abs(marker.time - time) < halfFrame)) {
    return { error: "There is already a marker on this frame." };
  }
  const marker: Marker = { id: newId(), time: Math.max(0, time), name, note: "" };
  return { project: { ...project, markers: sorted([...project.markers, marker]) }, marker };
}

export function updateMarker(
  project: Project,
  id: string,
  patch: Partial<Omit<Marker, "id">>,
): EditResult {
  if (!project.markers.some((marker) => marker.id === id)) return { error: "That marker is gone." };
  const markers = project.markers.map((marker) =>
    marker.id === id
      ? { ...marker, ...patch, time: Math.max(0, patch.time ?? marker.time) }
      : marker,
  );
  return { project: { ...project, markers: sorted(markers) } };
}

export function removeMarker(project: Project, id: string): EditResult {
  return { project: { ...project, markers: project.markers.filter((marker) => marker.id !== id) } };
}

/** The nearest marker before or after ``time``, for stepping from one to the next. */
export function markerBeside(
  project: Project,
  time: number,
  direction: -1 | 1,
): Marker | undefined {
  return direction > 0
    ? project.markers.find((marker) => marker.time > time + EPSILON)
    : [...project.markers].reverse().find((marker) => marker.time < time - EPSILON);
}

/** How a marker reads in lists and tooltips: its name, or else its place in the order. */
export function markerLabel(project: Project, marker: Marker): string {
  return marker.name || `Marker ${project.markers.indexOf(marker) + 1}`;
}
