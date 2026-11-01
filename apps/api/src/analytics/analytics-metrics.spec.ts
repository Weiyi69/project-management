import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateProjectHealth, getAnalyticsDateWindow, toCsv } from "./analytics-metrics";

test("does not report completion for an empty project", () => {
  const health = calculateProjectHealth({
    taskCount: 0,
    completedTasks: 0,
    overdueTasks: 0,
    dueSoonTasks: 0,
    unassignedTasks: 0,
  });

  assert.equal(health.status, "NEEDS_ATTENTION");
  assert.equal(health.completionRate, null);
  assert.match(health.reasons[0]!, /No tasks/);
});

test("prioritizes overdue work and explains every active health signal", () => {
  const health = calculateProjectHealth({
    taskCount: 5,
    completedTasks: 2,
    overdueTasks: 1,
    dueSoonTasks: 2,
    unassignedTasks: 1,
  });

  assert.equal(health.status, "AT_RISK");
  assert.equal(health.completionRate, 40);
  assert.equal(health.reasons.length, 3);
});

test("marks due-soon or unassigned work as needing attention", () => {
  const dueSoon = calculateProjectHealth({
    taskCount: 2,
    completedTasks: 1,
    overdueTasks: 0,
    dueSoonTasks: 1,
    unassignedTasks: 0,
  });
  const unassigned = calculateProjectHealth({
    taskCount: 2,
    completedTasks: 0,
    overdueTasks: 0,
    dueSoonTasks: 0,
    unassignedTasks: 2,
  });

  assert.equal(dueSoon.status, "NEEDS_ATTENTION");
  assert.equal(unassigned.status, "NEEDS_ATTENTION");
});

test("marks projects on track when no open-task health signals exist", () => {
  const health = calculateProjectHealth({
    taskCount: 3,
    completedTasks: 3,
    overdueTasks: 0,
    dueSoonTasks: 0,
    unassignedTasks: 0,
  });

  assert.equal(health.status, "ON_TRACK");
  assert.equal(health.completionRate, 100);
  assert.match(health.reasons[0]!, /No overdue/);
});

test("includes today and the next seven calendar days in the due window", () => {
  const { todayStart, dueSoonEnd } = getAnalyticsDateWindow(
    new Date("2026-11-01T19:45:00.000Z"),
  );

  assert.equal(todayStart.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(dueSoonEnd.toISOString(), "2026-11-09T00:00:00.000Z");
});

test("escapes CSV cells and neutralizes spreadsheet formulas", () => {
  const csv = toCsv([
    ["name", "value", "newline-prefixed value"],
    ["=1+1", 'A "quoted" name', "\n=1+1"],
  ]);

  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"A ""quoted"" name"/);
  assert.match(csv, /"'\n=1\+1"/);
});
