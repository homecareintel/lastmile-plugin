{
  "summary": "Explanation of run run-42: 2 unassigned job(s).",
  "untrusted": true,
  "untrustedFields": [
    "explanation.unassigned[].jobId"
  ],
  "runId": "run-42",
  "explanation": {
    "summary": {
      "headline": "2 jobs unassigned: time windows close before any vehicle can reach them."
    },
    "unassigned": [
      {
        "jobId": "J-17",
        "reasons": [
          {
            "vehicleId": "*",
            "reason": "TIME_WINDOW",
            "detail": "window 08:00-08:30 closes before the earliest arrival (08:52)"
          }
        ]
      },
      {
        "jobId": "J-88",
        "reasons": [
          {
            "vehicleId": "*",
            "reason": "SKILL",
            "detail": "requires skill wound-care; no worker has it"
          }
        ]
      }
    ]
  }
}
