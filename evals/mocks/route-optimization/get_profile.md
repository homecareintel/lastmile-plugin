{
  "summary": "Profile version 3 (shipment, PROFILE): 3 rule(s), 0 unsupported, 0 pending proposal(s).",
  "untrusted": true,
  "untrustedFields": [
    "narrative"
  ],
  "version": 3,
  "mode": "shipment",
  "modeSource": "PROFILE",
  "approvedAt": "2026-11-10T15:02:00Z",
  "narrative": "North depot drivers work 7am-5pm; everyone takes a 30 minute break.",
  "rules": [
    {
      "type": "shift",
      "workers": {
        "attribute": "depot",
        "values": [
          "north"
        ]
      },
      "start": 420,
      "end": 1020
    },
    {
      "type": "break",
      "workers": {},
      "windowStart": 690,
      "windowEnd": 810,
      "duration": 30
    },
    {
      "type": "priority",
      "jobs": {
        "attribute": "visitType",
        "values": [
          "SOC"
        ]
      },
      "priority": 1,
      "mustServe": true
    }
  ],
  "unsupported": [],
  "pendingProposals": []
}
